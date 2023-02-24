resultClickListeners()

function resultClickListeners(){
  const searchDiv = document.querySelector("#rso")
  const results = searchDiv.querySelectorAll("div.MjjYud")
  const linkedAreaSelector = "div.TbwUpd.NJjxre, div.p4InSe.iUh30, h3"

  const urlVars = getUrlVars(document.URL)
  const page = parseInt(urlVars.start) ? (parseInt(urlVars.start) / 10 + 1) : 1;
  
  // for(var i = 0; i < results.length; i++){
  //   results[i].addEventListener("click", async function() {
  //     console.log("onclick event listener script")
  //     const response = await chrome.runtime.sendMessage({content: i});
  //     console.log(response);
  //   })
  // }
  results.forEach((result) => {
    const linkedAreas = result.querySelectorAll(linkedAreaSelector)
    linkedAreas.forEach((linkedArea) => {
      linkedArea.addEventListener("click", async function() {
        console.log("onclick event listener script")
        const index = Array.prototype.indexOf.call(results, result);
        const response = await chrome.runtime.sendMessage({type: "resultClicked", content: {index: index, page: page}});
        console.log(response);
      })
    })
    
  })
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