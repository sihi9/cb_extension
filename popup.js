// listen for messages from background or content-script
chrome.runtime.onMessage.addListener(onMessageListener);

window.onload = requestAnalysis;


function onMessageListener(message, sender, sendResponse) {
  switch(message.type){
    case "parametersChanged":
      handleAnalysisResults(message.data)
      break;
    default:
      console.log("popup received unknown message: " + message.type)
  }
  sendResponse()
}

function requestAnalysis(){
  chrome.runtime.sendMessage({type: "analyze"}, handleAnalysisResults)
  createOffscreen()
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

function handleAnalysisResults(results){
  if(typeof results == "undefined" || results == null){
    setOkScreen();
    return;
  }

  highBiasSessions = []
  for(r of results){
    if(r.parameters.avg_index != -1 
      && r.parameters.avg_page != -1
      && r.parameters.queries.length != 0
      && r.bias > 0.4){
      highBiasSessions.push(r)
    }
  }
  if(highBiasSessions.length == 0) setOkScreen()
  else setErrorScreen(highBiasSessions)
}


function setOkScreen(){
  chrome.action.setIcon({ path: "./Icons/check_38.png" });
  document.getElementById("heading").innerText = "Keine Probleme erkannt";
  document.getElementById('queries').innerHTML = "";
}

function setErrorScreen(highBiasSessions){
  chrome.action.setIcon({ path: "./Icons/warning_38.png" });
  document.getElementById("heading").innerText = "Möglicher Bias erkannt für:";
  showHighBiasSession(highBiasSessions)
}


function showHighBiasSession(sessions) {
  var list = document.getElementById('queries');
  list.innerHTML = ""

  for (session of sessions) {
    console.log("high bias session: ")
    console.log(session)
    console.log("------------")
    list.appendChild(createErrorListItem(session.text, session.id));
  }
}

function createErrorListItem(text, sessionId){
  var item = document.createElement("li")
  var content = document.createElement("div")
  content.className = "content"
  content.innerText = text
  content.onclick = function() {
    startSearch(text)
  }
  var deleteButton = document.createElement("div")
  deleteButton.className = "delete"
  deleteButton.innerText = "x"
  deleteButton.onclick = function(){
    deleteSessionFromErrors(sessionId)
    item.remove()
  }
  item.appendChild(content)
  item.appendChild(deleteButton)
  return item;
}

function startSearch(text){
  text = text.replace(" ", "+")
  chrome.tabs.update({
    url: "http://www.google.com/search?q=" + text
});
}

function deleteSessionFromErrors(id){
  //todo: change naming
  chrome.runtime.sendMessage({type: "deleteSession", id : id})
}