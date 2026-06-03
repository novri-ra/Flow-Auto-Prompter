// Service worker for Flow Auto Prompter

// Configure the side panel to open when clicking the extension icon
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log("Flow Auto Prompter: Side panel behavior set to openPanelOnActionClick."))
    .catch((error) => console.error("Flow Auto Prompter: Error setting side panel behavior:", error));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log("Flow Auto Prompter: Side panel behavior set on startup."))
    .catch((error) => console.error("Flow Auto Prompter: Error setting side panel behavior on startup:", error));
});

// CDP Debugger Commands Bridge
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.action === "ATTACH_DEBUGGER") {
    (async () => {
      try {
        if (!tabId) {
          sendResponse({ success: false, error: "No target tab ID found." });
          return;
        }
        // Try to detach first in case it's already attached (ignore errors if not attached)
        try {
          await chrome.debugger.detach({ tabId });
        } catch (e) {
          // ignore
        }
        await chrome.debugger.attach({ tabId }, "1.3");
        console.log(`CDP Bridge: Attached to tab ID ${tabId}`);
        sendResponse({ success: true });
      } catch (err) {
        console.error("CDP Bridge: Attach failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keeps the message port open
  }

  if (message.action === "DETACH_DEBUGGER") {
    (async () => {
      try {
        if (!tabId) {
          sendResponse({ success: false, error: "No target tab ID found." });
          return;
        }
        await chrome.debugger.detach({ tabId });
        console.log(`CDP Bridge: Detached from tab ID ${tabId}`);
        sendResponse({ success: true });
      } catch (err) {
        console.warn("CDP Bridge: Detach failed or already detached:", err);
        sendResponse({ success: true }); // detach failure shouldn't halt flow
      }
    })();
    return true; // Keeps the message port open
  }

  if (message.action === "CDP_CLICK") {
    (async () => {
      try {
        if (!tabId) {
          sendResponse({ success: false, error: "No target tab ID found." });
          return;
        }
        const { x, y } = message;
        const buttonType = message.button || "left";

        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: buttonType,
          x: x,
          y: y,
          clickCount: 1
        });

        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button: buttonType,
          x: x,
          y: y,
          clickCount: 1
        });

        sendResponse({ success: true });
      } catch (err) {
        console.error("CDP_CLICK Error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keeps the message port open
  }

  if (message.action === "CDP_TYPE") {
    (async () => {
      try {
        if (!tabId) {
          sendResponse({ success: false, error: "No target tab ID found." });
          return;
        }
        const { text } = message;
        await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
          text: text
        });
        sendResponse({ success: true });
      } catch (err) {
        console.error("CDP_TYPE Error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keeps the message port open
  }
});
