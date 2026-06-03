// Content Script Automation Engine for Flow Auto Prompter (Google Flow)

console.log("Flow Auto Prompter: Automation script active and loaded.");

// Storage Key Schema
const STORAGE_KEYS = {
  isAutomating: "flow_is_automating",
  promptsText: "flow_prompts_text",
  failedPromptsText: "flow_failed_prompts_text",
  aspectRatio: "flow_aspect_ratio",
  batchSize: "flow_batch_size",
  model: "flow_model",
  restDelay: "flow_rest_delay",
  statsCompleted: "flow_stats_completed",
  statsFailed: "flow_stats_failed"
};

// In-memory run state tracking for instant cancellation
let isRunning = false;

// --- DOM / XPath Selectors & Helpers ---

function getElementByXpath(xpath, parent = document) {
  const result = document.evaluate(
    xpath,
    parent,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  return result.singleNodeValue;
}

function waitForElement(xpath, required = true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const element = getElementByXpath(xpath);
    if (element) {
      return resolve(element);
    }

    const intervalTime = 250;
    let elapsed = 0;

    const interval = setInterval(() => {
      // Monitor run state to abort instantly on user stop command
      if (!isRunning) {
        clearInterval(interval);
        reject(new Error("USER_STOPPED"));
        return;
      }

      const el = getElementByXpath(xpath);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else {
        elapsed += intervalTime;
        if (elapsed >= timeoutMs) {
          clearInterval(interval);
          if (required) {
            reject(new Error(`Timeout waiting for XPath: ${xpath}`));
          } else {
            resolve(null);
          }
        }
      }
    }, intervalTime);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Breakable pacing delay that checks in-memory state every 500ms for instant aborts
async function breakableDelay(ms) {
  let elapsed = 0;
  const step = 500;
  while (elapsed < ms) {
    if (!isRunning) {
      throw new Error("USER_STOPPED");
    }
    await delay(step);
    elapsed += step;
  }
}

async function findVisibleElement(xpath, timeout = 5000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    if (!isRunning) throw new Error("USER_STOPPED");
    const snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) {
      const el = snap.snapshotItem(i);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
        return el; // Only return if it actually has physical dimensions on screen
      }
    }
    await breakableDelay(500);
    elapsed += 500;
  }
  throw new Error(`Timeout finding visible element for XPath: ${xpath}`);
}

// Safely send message to the extension runtime (absorbs "Receiving end does not exist" errors)
function safeSendMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      // Access chrome.runtime.lastError to clear any unhandled runtime error if receiver is absent
      const err = chrome.runtime.lastError;
      if (callback) {
        callback(response);
      }
    });
  } catch (e) {
    console.warn("Flow Auto Prompter: safeSendMessage failed synchronously:", e);
  }
}

// --- CDP Debugger Bridge Operations ---

function attachDebugger() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "ATTACH_DEBUGGER" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && !response.success) {
        reject(new Error(response.error || "Debugger attach failed"));
      } else {
        console.log("Flow Auto Prompter: CDP Debugger attached successfully.");
        resolve();
      }
    });
  });
}

function detachDebugger() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "DETACH_DEBUGGER" }, (response) => {
      console.log("Flow Auto Prompter: CDP Debugger detached.");
      resolve();
    });
  });
}

// High-precision viewport click simulator using CDP command stream
async function cdpClick(element) {
  if (!element) return;
  
  // Bring the element into viewport focus to ensure correct coordinate mapping
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  await breakableDelay(300); // Settle viewport scrolling animation
  
  const rect = element.getBoundingClientRect();
  
  // Safety check to ensure the element has a physical layout and is visible
  if (rect.width === 0 || rect.height === 0 || (rect.x === 0 && rect.y === 0)) {
    throw new Error("Target element is hidden or off-screen (0,0). Cannot CDP click.");
  }
  
  const centerX = Math.round(rect.left + rect.width / 2);
  const centerY = Math.round(rect.top + rect.height / 2);

  console.log(`Flow Auto Prompter: Dispatching CDP click to center point (${centerX}, ${centerY})`);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "CDP_CLICK",
      x: centerX,
      y: centerY
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && !response.success) {
        reject(new Error(response.error || "CDP Click dispatch failed"));
      } else {
        resolve();
      }
    });
  });
}

async function cdpRightClick(element) {
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    await breakableDelay(300);
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || (rect.x === 0 && rect.y === 0)) {
        throw new Error("Target element is hidden or off-screen (0,0). Cannot CDP right-click.");
    }
    const centerX = Math.round(rect.left + rect.width / 2);
    const centerY = Math.round(rect.top + rect.height / 2);
    
    await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "CDP_CLICK", x: centerX, y: centerY, button: 'right' }, resolve);
    });
}

// Robust text input injector using verify & retry loop for Slate.js
async function injectTextRobust(text) {
  const element = await findVisibleElement("//div[@data-slate-editor='true'] | //div[@role='textbox' and @contenteditable='true']", 5000);

  let success = false;
  for (let i = 0; i < 5; i++) {
    if (!isRunning) throw new Error("USER_STOPPED");
    
    console.log(`Flow Auto Prompter: Attempting Slate.js text injection (Attempt ${i + 1}/5)...`);

    // 1. Force focus
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    await breakableDelay(500);
    element.focus();
    await cdpClick(element); 
    await breakableDelay(800);
    
    // 2. Clear existing text
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (e) {
      console.warn("Slate selectAll/delete failed", e);
    }
    await breakableDelay(200);
    
    // 3. Inject text (Native + CDP combo)
    try {
      document.execCommand('insertText', false, text);
    } catch (e) {
      console.warn("execCommand insertText failed", e);
    }
    
    // Send the CDP_TYPE payload via the background bridge and await completion
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "CDP_TYPE", text: text }, () => {
        const err = chrome.runtime.lastError; // clear error
        resolve();
      });
    });
    
    await breakableDelay(1000); // Wait for React state to update
    
    // 4. Verify
    if (element.textContent.trim().length > 0) {
      success = true;
      console.log("Flow Auto Prompter: Prompt text successfully verified in DOM.");
      break;
    }
    console.warn(`Flow Auto Prompter: Injection failed on attempt ${i + 1}, retrying...`);
  }
  if (!success) {
    throw new Error("Failed to inject prompt text after 5 attempts. Slate.js rejected input.");
  }
}

// --- Google Flow Action Layer ---

// Apply aspect ratio, batch size, and model settings
async function configureSettings(settings, currentPrompt) {
  console.log("Flow Auto Prompter: Triggering settings dropdown setup...", settings);

  // 1. Open the Main Settings Menu (Strictly avoiding Agent button)
  const mainTrigger = await waitForElement("//button[not(contains(., 'Agent')) and (.//i[contains(text(), 'tune')] or contains(., '1x') or contains(., 'Nano') or contains(., 'Imagen'))]", true, 5000);
  await cdpClick(mainTrigger);
  await breakableDelay(1000); // Wait for Radix portal to render

  // 2. Select Aspect Ratio
  const ratioBtn = await waitForElement("//button[@role='tab' and contains(., '" + settings.aspectRatio + "')]", true, 3000);
  await cdpClick(ratioBtn);
  console.log(`Flow Auto Prompter: Selected Aspect Ratio: ${settings.aspectRatio}`);

  // 3. Select Batch Size
  const batchBtn = await waitForElement("//button[@role='tab' and contains(., '" + settings.batchSize + "')]", true, 3000);
  await cdpClick(batchBtn);
  console.log(`Flow Auto Prompter: Selected Batch Size: ${settings.batchSize}`);

  // 4. Select Model (Nested Menu with arrow_drop_down, wrapped in try/catch)
  try {
    const modelTrigger = await waitForElement("//button[@aria-haspopup='menu' and .//i[contains(text(), 'arrow_drop_down')]]", true, 2000);
    await cdpClick(modelTrigger);
    await breakableDelay(500);

    const targetModel = settings.modelSelection || settings.model || "Nano Banana 2";
    const modelOption = await waitForElement("//div[@role='menuitem' and contains(., '" + targetModel + "')]", true, 2000);
    await cdpClick(modelOption);
    console.log(`Flow Auto Prompter: Selected Model option: ${targetModel}`);
  } catch (e) {
    console.warn("Flow Auto Prompter: Model selection skipped or already set", e);
  }

  // 5. Inject Prompt via Robust Verify & Retry Loop
  await injectTextRobust(currentPrompt);
}

// --- Automation State Machine Loop ---

async function runAutomationCycle() {
  while (isRunning) {
    try {
      // Always query fresh storage data at the beginning of each cycle to check state
      const storageData = await new Promise(resolve => chrome.storage.local.get(Object.values(STORAGE_KEYS), resolve));

      const isAutomating = storageData[STORAGE_KEYS.isAutomating] === true;
      if (!isAutomating || !isRunning) {
        console.log("Flow Auto Prompter: Automation state is inactive. Halting queue.");
        break;
      }

      const rawPrompts = storageData[STORAGE_KEYS.promptsText] || "";
      const prompts = rawPrompts.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      if (prompts.length === 0) {
        console.log("Flow Auto Prompter: Queue depleted. Shutting down active loop.");
        isRunning = false;
        await detachDebugger();
        chrome.storage.local.set({ [STORAGE_KEYS.isAutomating]: false }, () => {
          safeSendMessage({ action: "AUTOMATION_PROGRESS", isDone: true });
        });
        break;
      }

      const currentPrompt = prompts[0];
      console.log("Flow Auto Prompter: Active item:", currentPrompt);

      // Stage 1 & 2: Settings setup and prompt text injection
      console.log("Flow Auto Prompter: ⚙️ Configuring settings...");
      const settings = {
        aspectRatio: storageData[STORAGE_KEYS.aspectRatio] || "1:1",
        batchSize: storageData[STORAGE_KEYS.batchSize] || "1x",
        model: storageData[STORAGE_KEYS.model] || "Nano Banana 2",
        modelSelection: storageData[STORAGE_KEYS.model],
        prompts: prompts
      };
      await configureSettings(settings, currentPrompt);

      console.log("Flow Auto Prompter: ✍️ Injecting prompt and waiting for render...");
      // Stage 3: Submit prompt and robustly poll for generation completion
      console.log("Flow Auto Prompter: Locating submit button...");
      const submitBtn = await findVisibleElement("//button[.//i[contains(text(), 'arrow_forward')]]", 5000);

      // 1. Count Before Submit:
      const initialTileCount = document.evaluate("count(//img[@alt='Generated image'])", document, null, XPathResult.NUMBER_TYPE, null).numberValue;
      console.log(`Flow Auto Prompter: Initial tile count: ${initialTileCount}`);

      // 2. Submit:
      await cdpClick(submitBtn);
      console.log("Flow Auto Prompter: Submit clicked.");

      // 3. Stage 1: Wait for New Tile in DOM:
      console.log("Flow Auto Prompter: Stage 1 - Waiting for new tile to appear in DOM...");
      let newTileAppeared = false;
      for (let i = 0; i < 60; i++) { // Max 30 seconds wait
          if (!isRunning) throw new Error("USER_STOPPED");
          const warningToast = document.evaluate("//*[contains(text(), 'unusual activity') or contains(text(), 'You have reached the limit')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (warningToast) {
              throw new Error("CRITICAL_ACCOUNT_BLOCK");
          }
          const currentTileCount = document.evaluate("count(//img[@alt='Generated image'])", document, null, XPathResult.NUMBER_TYPE, null).numberValue;
          if (currentTileCount > initialTileCount) {
              newTileAppeared = true; 
              break;
          }
          await breakableDelay(500);
      }
      if (!newTileAppeared) throw new Error("Generation timeout: New image tile never appeared in DOM.");

      // 4. Stage 2: Wait for Blur 0px AND No Percentages:
      console.log("Flow Auto Prompter: Stage 2 - Waiting for blur 0px and no percentage indicators...");
      let imageReady = false;
      let targetCard = null;
      for (let i = 0; i < 30; i++) { // Max 15 seconds wait for paint
          if (!isRunning) throw new Error("USER_STOPPED");

          const pctIndicator = document.evaluate("//div[contains(text(), '%')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          targetCard = document.evaluate("//div[contains(@style, '--blur-amount: 0px') and contains(@style, 'opacity: 1') and .//img[@alt='Generated image'] and not(@data-flow-downloaded)]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

          if (!pctIndicator && targetCard) {
              imageReady = true; 
              break;
          }
          await breakableDelay(500);
      }
      if (!imageReady) throw new Error("Render timeout: Image never fully resolved to 0px blur.");

      await breakableDelay(2500); // Strict final human-safety buffer

      console.log("Flow Auto Prompter: ⬇️ Triggering Right-Click Download...");
      // Stage 3: Trigger Download (Right-Click Bypass)
      try {
          console.log("Flow Auto Prompter: Right-clicking the generated image...");
          // 1. Find the actual image inside the verified target card
          const generatedImg = document.evaluate(".//img[@alt='Generated image']", targetCard, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!generatedImg) throw new Error("Could not find the image element to right-click.");
          
          // Trigger Context Menu
          await cdpRightClick(generatedImg);
          await breakableDelay(1000); // Wait for Radix portal

          // 2. Click "Download" (Trigger for submenu)
          console.log("Flow Auto Prompter: Clicking 'Download' option...");
          const downloadMenuItem = await findVisibleElement("//div[@role='menuitem' and contains(., 'Download')]");
          await cdpClick(downloadMenuItem);
          await breakableDelay(1000); // Wait for submenu portal

          // 3. Click "1K Original size"
          console.log("Flow Auto Prompter: Selecting 1K resolution...");
          const resolution1KBtn = await findVisibleElement("//button[@role='menuitem' and .//span[contains(text(), '1K')]]");
          await cdpClick(resolution1KBtn);
          
          await breakableDelay(3000); // Wait for download stream to initiate

          // 4. Cleanup
          targetCard.setAttribute('data-flow-downloaded', 'true');
          console.log("Flow Auto Prompter: Download triggered. Card marked.");
          
          // 5. Safe Cleanup: Close Radix menus
          try {
              console.log("Flow Auto Prompter: Sending Escape key to dismiss menus...");
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              const radixOverlay = document.querySelector('[data-radix-focus-guard]');
              if (radixOverlay) radixOverlay.click();
          } catch (e) {
              console.warn("Silent cleanup warning:", e);
          }

      } catch (err) {
          throw new Error("Failed during download menu sequence: " + err.message);
      }

      console.log("Flow Auto Prompter: ✅ Cycle complete. Advancing queue.");
      // Stage 9: Process Queue cleanup and trigger pacing delay before proceeding
      settings.prompts.shift();
      const remainingPrompts = settings.prompts.join("\n");
      const currentCompleted = parseInt(storageData[STORAGE_KEYS.statsCompleted] || 0, 10) + 1;
      const currentFailed = parseInt(storageData[STORAGE_KEYS.statsFailed] || 0, 10);

      const updates = {
        [STORAGE_KEYS.promptsText]: remainingPrompts,
        [STORAGE_KEYS.statsCompleted]: currentCompleted
      };

      await new Promise(resolve => chrome.storage.local.set(updates, resolve));

      // Send UPDATE_TEXTAREA message to the side panel
      safeSendMessage({
        action: "UPDATE_TEXTAREA",
        promptsText: remainingPrompts
      });

      // Send progress update to side panel UI
      safeSendMessage({
        action: "AUTOMATION_PROGRESS",
        stats: { completed: currentCompleted, failed: currentFailed },
        remainingPromptsText: remainingPrompts,
        isDone: settings.prompts.length === 0
      });

      if (settings.prompts.length === 0) {
        console.log("Flow Auto Prompter: Queue depleted. Shutting down active loop.");
        isRunning = false;
        await detachDebugger();
        chrome.storage.local.set({ [STORAGE_KEYS.isAutomating]: false }, () => {
          safeSendMessage({ action: "AUTOMATION_PROGRESS", isDone: true });
        });
        break;
      }

      // Read Rest Delay Configuration
      const baseRest = parseInt(storageData[STORAGE_KEYS.restDelay] || 5, 10) * 1000;
      const humanVariance = Math.floor(Math.random() * 5000); // 0 to 5 seconds random
      const restTime = baseRest + humanVariance;
      console.log(`Flow Auto Prompter: Pacing cycle. Resting for ${(restTime/1000).toFixed(1)} seconds (includes human variance)...`);
      safeSendMessage({
        action: "AUTOMATION_PROGRESS",
        statusText: `Resting for ${(restTime/1000).toFixed(1)}s...`
      });

      // Trigger breakable delay
      await breakableDelay(restTime);

      // Resume status back to running for the next prompt
      safeSendMessage({
        action: "AUTOMATION_PROGRESS",
        statusText: "Running"
      });

    } catch (e) {
      if (e.message === "CRITICAL_ACCOUNT_BLOCK") {
          console.error("Flow Auto Prompter: 🛑 EMERGENCY STOP. Google blocked the request (403/Unusual Activity). Automation halted to protect your account.");
          isRunning = false;
          chrome.storage.local.set({ [STORAGE_KEYS.isAutomating]: false, isRunning: false });
          // Tell the background/panel to stop the UI
          chrome.runtime.sendMessage({ action: "UPDATE_STATUS", status: "BLOCKED BY GOOGLE" });
          return; // Completely exit the automation loop. Do NOT reload, do NOT skip to next.
      }

      if (e.message === "USER_STOPPED" || e.message === "AUTOMATION_STOPPED") {
        console.log("Flow Auto Prompter: Automation stopped gracefully by user.");
        isRunning = false;
        await detachDebugger();
        break;
      }

      // Query fresh storage data inside catch block to ensure recovery variables are initialized properly
      const storageData = await new Promise(resolve => chrome.storage.local.get(Object.values(STORAGE_KEYS), resolve));
      const rawPrompts = storageData[STORAGE_KEYS.promptsText] || "";
      const prompts = rawPrompts.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      const currentPrompt = prompts[0] || "";

      console.error("Flow Auto Prompter: ❌ Cycle failed for prompt:", currentPrompt, " | Reason:", e.message);

      // Detach debugger prior to recovery reload to release control slot
      await detachDebugger();

      // Error recovery: Add to safety net (failed list), shift queue, trigger restart reload to clear state
      const failedText = storageData[STORAGE_KEYS.failedPromptsText] || "";
      const newFailedText = failedText ? `${failedText}\n${currentPrompt}` : currentPrompt;
      const remainingPrompts = prompts.slice(1).join("\n");
      
      const currentCompleted = parseInt(storageData[STORAGE_KEYS.statsCompleted] || 0, 10);
      const currentFailed = parseInt(storageData[STORAGE_KEYS.statsFailed] || 0, 10) + 1;

      const updates = {
        [STORAGE_KEYS.promptsText]: remainingPrompts,
        [STORAGE_KEYS.failedPromptsText]: newFailedText,
        [STORAGE_KEYS.statsFailed]: currentFailed
      };

      chrome.storage.local.set(updates, () => {
        safeSendMessage({
          action: "AUTOMATION_PROGRESS",
          stats: { completed: currentCompleted, failed: currentFailed },
          remainingPromptsText: remainingPrompts,
          failedPromptsText: newFailedText,
          isDone: prompts.length <= 1
        }, () => {
          console.warn("Flow Auto Prompter: Critical step exception caught. Triggering recovery context reload...");
          window.location.reload();
        });
      });
      break;
    }
  }
}

// --- Message Handlers & Observers ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING") {
    sendResponse({ success: true, status: "pong" });
    return true;
  }

  if (request.action === "START_FLOW_AUTOMATION") {
    if (!window.location.href.includes("labs.google/fx/tools/flow")) {
      sendResponse({ success: false, message: "Incorrect target URL." });
      return true;
    }

    const updates = {
      [STORAGE_KEYS.isAutomating]: true,
      [STORAGE_KEYS.promptsText]: request.prompts.join("\n"),
      [STORAGE_KEYS.aspectRatio]: request.aspectRatio,
      [STORAGE_KEYS.batchSize]: request.batchSize,
      [STORAGE_KEYS.model]: request.model,
      [STORAGE_KEYS.restDelay]: request.restDelay
    };

    chrome.storage.local.set(updates, async () => {
      try {
        // Attempt to attach the CDP debugger prior to starting the loop
        await attachDebugger();
        sendResponse({ success: true, message: "Automation started successfully." });
        
        // Start loop execution
        isRunning = true;
        runAutomationCycle();
      } catch (err) {
        console.error("Flow Auto Prompter: Debugger attachment failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (request.action === "STOP_FLOW_AUTOMATION") {
    isRunning = false;
    detachDebugger();
    chrome.storage.local.set({ [STORAGE_KEYS.isAutomating]: false }, () => {
      sendResponse({ success: true, message: "Automation stopped." });
    });
    return true;
  }
});

// Automatic check on page load to see if automation loop should be running/resumed
if (window.location.href.includes("labs.google/fx/tools/flow")) {
  chrome.storage.local.get(Object.values(STORAGE_KEYS), async (result) => {
    if (result[STORAGE_KEYS.isAutomating] === true) {
      try {
        await attachDebugger();
        isRunning = true;
        console.log("Flow Auto Prompter: Resuming active automation queue...");
        runAutomationCycle();
      } catch (err) {
        console.error("Flow Auto Prompter: Debugger resume attachment failed:", err);
      }
    }
  });
}
