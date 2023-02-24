// send a message every 20 sec to service worker
console.log("offscreen script1")
setInterval(() => {
  console.log("offscreen script")
  chrome.runtime.sendMessage({ type: "keepAlive" });
}, 20000);