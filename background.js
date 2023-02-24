var sessions = {} // dict with sessionID as key, action[] as value

const ActionTypes = {
  search: "search",             // issue new search query;  data = {query, page}
  resultClick: "resultClick",   // click on query result;   data = {index}
  serpReturn: "serpReturn"      // return to SERP;          data = {}
}

const production = true
var currentTab = 0;
var currentSession = -1;
var highestSessionID = -1;

var latestAnalysis = undefined

// listen for messages from content-script or popup
chrome.runtime.onMessage.addListener(onMessageListener);
// log new history entry
chrome.history.onVisited.addListener(onHistoryVisitedListener);

chrome.runtime.onStartup.addListener(createOffscreen);


async function onMessageListener(message, sender, sendResponse) {
  switch(message.type){
    case "analyze":
      sendResponse(latestAnalysis)
    case "resultClicked":
      handleResultClickedMessage(message, sender, sendResponse);
      break;
    case "deleteSession":
      handleDeleteSessionMessage(message);
      break;
    case "keepAlive":
      console.info("received keepAlive message")
      console.info(sessions)
      break;
    default:
      console.info("bg received unknown message: " + message.type)
  }
  sendResponse()
}

function handleResultClickedMessage(message, sender, sendResponse){
  // todo: clicking multiple times leads to multiple event calls. Handle this
  if(!sender.tab){
    sendResponse({content: "unknown"})
    return;
  }
  const senderID = sender.tab.id;
  const page = message.content.page;
  const index = message.content.index + ((page - 1) * 10);


  const action = createAction(ActionTypes.resultClick, Date.now(), senderID, {index: index, page: page})
  addAction(action)

  sendResponse({content: "thank you"});
}

function handleDeleteSessionMessage(message){
  const id = message.id;
  if(sessions.hasOwnProperty(id)){
    delete sessions[id];
    if(id == currentSession){
      currentSession == -1;
      updateView();
    }
  }
    
}

function onHistoryVisitedListener(result) {
  // also procs when returning to previous search. Check searchID?
  console.log("visited: " + result.title)
  var title = result.title

  if(!title.includes(" - Google Search")) 
    return;

  const urlVars = getUrlVars(result.url)
  const page = parseInt(urlVars.start) ? (parseInt(urlVars.start) / 10 + 1) : 1;
  //var query = urlVars.q 
  //query = query.replace("+", " ")
  title = title.replace(" - Google Search", "")
  const action = createAction(ActionTypes.search, result.lastVisitTime, getCurrentTab(), {query: title, page: page})
  addAction(action)
}

// https://stackoverflow.com/a/6045609
function getUrlVars(href)
{
    var vars = [], hash;
    var hashes = href.slice(href.indexOf('?') + 1).split('&');
    for(var i = 0; i < hashes.length; i++)
    {
        hash = hashes[i].split('=');
        vars.push(hash[0]);
        vars[hash[0]] = hash[1];
    }
    return vars;
}

function isPopupOpen(){
  return typeof document !== 'undefined'
}

chrome.tabs.onActivated.addListener(function(activeInfo) {
  currentTab = activeInfo.tabId
})

function getCurrentTab(){
  return currentTab;
}

function createAction(type, timeStamp, tabId, data){
  return  {type: type, timeStamp: timeStamp, tabId: tabId, data: data}
}

function addAction(action){
  console.info("adding action: " + JSON.stringify(action))
  if(highestSessionID == -1){
    highestSessionID = 0;
    sessions[highestSessionID] = [action];
    currentSession = 0;
  } else{
    switch(action.type){
      case ActionTypes.resultClick:
        if(currentSession !== -1)
          sessions[currentSession].push(action);
        break;
      case ActionTypes.search: 
        addSearchAction(action);  // this runs async
        break;
      default:
        console.error("unhandled action type: " + JSON.stringify(action))
    }
  }
  updateView()
}

async function addSearchAction(action){
  let bestFit = await findBestFit(action)
  if(bestFit.sessionID !== -1){
    //sessions[bestFit].push(action)
    console.info("adding new action to previous action. Confidence: " + bestFit.confidence)
    currentSession = bestFit.sessionID;
    pushSearchAction(bestFit.sessionID, action)
    return;
  }
  
  // no good fit found. Check if decent fit for current session
  if(currentSession == -1){
    highestSessionID += 1
    sessions[highestSessionID] = [action]
    currentSession = highestSessionID;
    return;
  }

  var lastInteraction = undefined
  var queries = []

  sessions[currentSession].forEach(x => {
    if(x.type == ActionTypes.search){
      queries.push(x.data.query)
    }
    lastInteraction = x
  })

  if (typeof lastInteraction == 'undefined'){
    // this is the first search query
    highestSessionID += 1
    sessions[highestSessionID] = [action]
  }
  else{
    let maxSim = await getMaxSim(action.data.query, queries)
    let togetherness = getTogetherness((action.timeStamp - lastInteraction.timeStamp) / 1000, maxSim)

    if(togetherness > 0.2){
      // add to current session
      //sessions[currentSession].push(action)
      console.info("adding new action to current session with confidence: " + togetherness)
      pushSearchAction(currentSession, action)
    } else{
      // start new session
      highestSessionID += 1
      sessions[highestSessionID] = [action]
      currentSession = highestSessionID;
      console.info("starting new session with confidence: " + (1-togetherness))
    }
  }
}

function pushSearchAction(sessionID, action){
  // todo: to filter or not to filter, thats the quesiton (analyze has a uniqueness check as well)
  //sessions[sessionID] = sessions[sessionID].filter(a => a.data.query != action.data.query) 
  sessions[sessionID].push(action)
}

/**
 * Checks all sessions to see if new actions fits well in any of them
 *
 * @param {object} action new action
 * @return {number} SessionID if good fit is found, -1 otherwise
 */
async function findBestFit(action){
  let maxSim = 0.8;
  let bestSession = -1;
  for(id in sessions){
    var queries = []
    sessions[id].forEach(a => {
      if(a.type == ActionTypes.search)
        queries.push(a.data.query)
    })
    let sim = await getMaxSim(action.data.query, queries)
    if(sim >= maxSim){
      maxSim = sim;
      bestSession = id;
    }
  }
  return {
    sessionID: bestSession,
    confidence: maxSim
  }
}

/**
 * Returns a value between 0 and 1 decribing the likelihood of a query belonging to a search session with given parameters
 *
 * @param {number} timedifference time in seconds between the last query and the most recet query
 * @param {number} similarity the max similarity between the most recent query and all other queries of the session
 * @return {number} likelihood to belong between 0 (unlikely) and 1 (likely)
 */
function getTogetherness(timedifference, similarity){
  // todo: improve this
  // values taken from online survey
  if(similarity > 0.8) // time doesnt matter if the fit is that good
    return similarity

  const avg_duration = production ? 426 : 10 
  const std_duration = production ? 108 : 10
  const timediff_z = (timedifference - avg_duration) / (std_duration * 2) // multiply by 2 to flatten curve -> allow higher deviations
  return sigmoid(-timediff_z) * similarity
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}


async function getSimilarities(queries){
  var similarity = await makeAPIRequest("/sim", { queries: queries})
  return similarity.sim
}

async function getCommon(queries){
  const route = "/common"
  const common = await makeAPIRequest(route, {queries: queries})
  return common.result
}

async function getMaxSim(text, others){
  const sim = await makeAPIRequest("/maxSim", {text: text, others: others})
  return sim.result
}
async function makeAPIRequest(route, data){
  var url = ""
  if(production)
    url = "https://hitzginger.com/api"
  else
    url = "http://127.0.0.1:5000"

  url += route

  return await postData(url, data)
}

async function postData(url = '', data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data) 
  });
  if(response.ok)
    return response.json(); 
  else {
    console.error("Error on POST Request to" + url + " with data " + JSON.stringify(data))
    return {}
  }
}


function calculateParameters(actions){
  searchDict = {}
  var n_results = 0;
  var indexSum = 0;
  var pageSum = 0;

  for(var i = 0; i < actions.length; i++){
    switch(actions[i].type){
      case ActionTypes.search:
        const query = actions[i].data.query
        if(query in searchDict) searchDict[query] += 1;
        else searchDict[query] = 1;
        break;
      case ActionTypes.resultClick:
        n_results += 1;
        indexSum += (actions[i].data.index + 1);
        pageSum += actions[i].data.page; 
        break;
    }
  }

  const avg_index = n_results > 0 ? indexSum / n_results : 0;
  const avg_page = n_results > 0 ? pageSum / n_results : -1;
  const n_queries = Object.keys(searchDict).length;

  return {
    n_queries: n_queries,
    n_results: n_results,
    avg_index: avg_index,
    avg_page: avg_page,
    queries: Object.keys(searchDict)
  }
}

async function analyze(){
  results = [];
  for(k in sessions){
    const x = calculateParameters(sessions[k]);
    const bestStringRepresentation = await getCommon(x.queries);
    const bias = -0.038 * x.n_queries - 0.042 * x.n_results - 0.019 * x.avg_index + 0.79;

    results.push({
      parameters: x,
      bias: bias,
      text: bestStringRepresentation,
      id: k
    })
  }

  latestAnalysis = results;
  return results
}

async function updateView(){
  const results = await analyze()
  for(r of results){
    if(r.parameters.avg_index != -1 
      && r.parameters.avg_page != -1
      && r.parameters.queries.length != 0
      && r.bias > 0.4){
        setWarningIcon();
        return;
    }
  }
  setOkIcon()
}

function setWarningIcon(){
  chrome.action.setIcon({ path: "./Icons/warning_38.png" });
}

function setOkIcon(){
  chrome.action.setIcon({ path: "./Icons/check_38.png" });
}

// create the offscreen document if it doesn't already exist
// this is some shitty workaround for bad chrome api behaviour 
// refer to: https://stackoverflow.com/a/66618269
async function createOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
 
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ['BLOBS'],
    justification: 'keep service worker running',
  });
}