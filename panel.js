// Controller script for Flow Auto Prompter Side Panel

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const promptsInput = document.getElementById("prompts-input");
  const failedPromptsInput = document.getElementById("failed-prompts-input");
  const aspectRatioSelect = document.getElementById("aspect-ratio-select");
  const batchSizeSelect = document.getElementById("batch-size-select");
  const modelSelect = document.getElementById("model-select");
  const restDelaySelect = document.getElementById("restDelay");
  const toggleBtn = document.getElementById("toggle-btn");
  const playIcon = document.getElementById("play-icon");
  const stopIcon = document.getElementById("stop-icon");
  const btnText = document.getElementById("btn-text");
  const promptBadge = document.getElementById("prompt-badge");
  
  const statsQueued = document.getElementById("stats-queued");
  const statsCompleted = document.getElementById("stats-completed");
  const statsFailed = document.getElementById("stats-failed");
  
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const resetBtn = document.getElementById("reset-btn");

  let isAutomating = false;

  // Connection states
  function setConnectionStatus(status, label) {
    statusDot.className = "status-dot";
    if (status === "connected") {
      statusDot.classList.add("connected");
      statusText.textContent = label || "Connected";
    } else if (status === "active") {
      statusDot.classList.add("active");
      statusText.textContent = label || "Automating";
    } else {
      statusText.textContent = label || "Disconnected";
    }
  }

  // Check if active tab is Google Flow and content script is ready
  async function checkActiveTab() {
    if (isAutomating) return; // Keep status as active/automating
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes("labs.google")) {
        // Send a ping to check if content script is loaded
        chrome.tabs.sendMessage(tab.id, { action: "PING" }, (response) => {
          if (chrome.runtime.lastError) {
            setConnectionStatus("disconnected", "No Connection");
          } else if (response && response.status === "pong") {
            setConnectionStatus("connected", "Ready");
          } else {
            setConnectionStatus("connected", "Ready");
          }
        });
      } else {
        setConnectionStatus("disconnected", "Not on Flow");
      }
    } catch (err) {
      setConnectionStatus("disconnected", "Disconnected");
    }
  }

  // Update prompt counters based on input
  function updatePromptCount() {
    const text = promptsInput.value;
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    promptBadge.textContent = `${lines.length} prompt${lines.length === 1 ? '' : 's'}`;
    statsQueued.textContent = lines.length;
  }

  // Storage key schema
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

  // Save parameters & inputs to local storage
  function saveToStorage() {
    const data = {
      [STORAGE_KEYS.promptsText]: promptsInput.value,
      [STORAGE_KEYS.failedPromptsText]: failedPromptsInput.value,
      [STORAGE_KEYS.aspectRatio]: aspectRatioSelect.value,
      [STORAGE_KEYS.batchSize]: batchSizeSelect.value,
      [STORAGE_KEYS.model]: modelSelect.value,
      [STORAGE_KEYS.restDelay]: restDelaySelect.value
    };
    chrome.storage.local.set(data);
  }

  // Load configuration from storage
  function loadFromStorage() {
    chrome.storage.local.get(Object.values(STORAGE_KEYS), (result) => {
      if (result[STORAGE_KEYS.promptsText] !== undefined) {
        promptsInput.value = result[STORAGE_KEYS.promptsText];
      }
      if (result[STORAGE_KEYS.failedPromptsText] !== undefined) {
        failedPromptsInput.value = result[STORAGE_KEYS.failedPromptsText];
      }
      if (result[STORAGE_KEYS.aspectRatio] !== undefined) {
        aspectRatioSelect.value = result[STORAGE_KEYS.aspectRatio];
      }
      if (result[STORAGE_KEYS.batchSize] !== undefined) {
        batchSizeSelect.value = result[STORAGE_KEYS.batchSize];
      }
      if (result[STORAGE_KEYS.model] !== undefined) {
        modelSelect.value = result[STORAGE_KEYS.model];
      }
      if (result[STORAGE_KEYS.restDelay] !== undefined) {
        restDelaySelect.value = result[STORAGE_KEYS.restDelay];
      }
      if (result[STORAGE_KEYS.statsCompleted] !== undefined) {
        statsCompleted.textContent = result[STORAGE_KEYS.statsCompleted];
      } else {
        statsCompleted.textContent = "0";
      }
      if (result[STORAGE_KEYS.statsFailed] !== undefined) {
        statsFailed.textContent = result[STORAGE_KEYS.statsFailed];
      } else {
        statsFailed.textContent = "0";
      }
      
      if (result[STORAGE_KEYS.isAutomating] === true) {
        isAutomating = true;
        toggleBtn.classList.remove("start-state");
        toggleBtn.classList.add("stop-state");
        playIcon.style.display = "none";
        stopIcon.style.display = "inline";
        btnText.textContent = "Stop Automation";
        setConnectionStatus("active", "Running");
      } else {
        cleanupStopState();
      }

      updatePromptCount();
    });
  }

  // Input Listeners for auto-saving
  promptsInput.addEventListener("input", () => {
    updatePromptCount();
    saveToStorage();
  });
  failedPromptsInput.addEventListener("input", saveToStorage);
  aspectRatioSelect.addEventListener("change", saveToStorage);
  batchSizeSelect.addEventListener("change", saveToStorage);
  modelSelect.addEventListener("change", saveToStorage);
  restDelaySelect.addEventListener("change", saveToStorage);

  // Toggle button actions
  toggleBtn.addEventListener("click", async () => {
    if (!isAutomating) {
      // Parse prompts queue
      const rawText = promptsInput.value;
      const prompts = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      if (prompts.length === 0) {
        alert("Please enter at least one valid prompt in the queue.");
        return;
      }

      // Find active tab to inject or message
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          alert("No active browser tab found.");
          return;
        }

        if (!tab.url || !tab.url.includes("labs.google")) {
          alert("Please open a Google Flow tab (labs.google) to start automation.");
          return;
        }

        // Send START message to content script
        chrome.tabs.sendMessage(tab.id, {
          action: "START_FLOW_AUTOMATION",
          prompts: prompts,
          aspectRatio: aspectRatioSelect.value,
          batchSize: batchSizeSelect.value,
          model: modelSelect.value,
          restDelay: restDelaySelect.value
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Message error:", chrome.runtime.lastError.message);
            alert("Could not communicate with Google Flow tab. Please refresh the page and try again.");
            return;
          }

          if (response && response.success) {
            // Update UI state to Running
            isAutomating = true;
            toggleBtn.classList.remove("start-state");
            toggleBtn.classList.add("stop-state");
            playIcon.style.display = "none";
            stopIcon.style.display = "inline";
            btnText.textContent = "Stop Automation";
            setConnectionStatus("active", "Running");
          }
        });
      } catch (err) {
        console.error("Failed to query tabs:", err);
      }
    } else {
      // Send STOP message to content script
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: "STOP_FLOW_AUTOMATION" }, (response) => {
            // Even if message fails due to tab refresh, we should clean up UI locally
            cleanupStopState();
          });
        } else {
          cleanupStopState();
        }
      } catch (err) {
        cleanupStopState();
      }
    }
  });

  function cleanupStopState() {
    isAutomating = false;
    toggleBtn.classList.remove("stop-state");
    toggleBtn.classList.add("start-state");
    playIcon.style.display = "inline";
    stopIcon.style.display = "none";
    btnText.textContent = "Start Automation";
    checkActiveTab();
  }

  // Reset Configuration Action
  resetBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to reset all prompts and metrics?")) {
      promptsInput.value = "";
      failedPromptsInput.value = "";
      aspectRatioSelect.value = "1:1";
      batchSizeSelect.value = "1x";
      modelSelect.value = "Nano Banana 2";
      restDelaySelect.value = "5";
      statsCompleted.textContent = "0";
      statsFailed.textContent = "0";
      
      const resetData = {
        [STORAGE_KEYS.promptsText]: "",
        [STORAGE_KEYS.failedPromptsText]: "",
        [STORAGE_KEYS.aspectRatio]: "1:1",
        [STORAGE_KEYS.batchSize]: "1x",
        [STORAGE_KEYS.model]: "Nano Banana 2",
        [STORAGE_KEYS.restDelay]: "5",
        [STORAGE_KEYS.statsCompleted]: 0,
        [STORAGE_KEYS.statsFailed]: 0
      };
      
      chrome.storage.local.set(resetData, () => {
        updatePromptCount();
        checkActiveTab();
      });
    }
  });

  // Track tab adjustments to update connection badge in real-time
  chrome.tabs.onActivated.addListener(checkActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      checkActiveTab();
    }
  });

  // Handle messages from content script (e.g. status updates, completed/failed reports)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "UPDATE_STATUS") {
      setConnectionStatus("disconnected", message.status);
      cleanupStopState();
    }
    if (message.action === "UPDATE_TEXTAREA") {
      if (message.promptsText !== undefined) {
        promptsInput.value = message.promptsText;
        chrome.storage.local.set({ [STORAGE_KEYS.promptsText]: message.promptsText });
        updatePromptCount();
      }
    }
    if (message.action === "AUTOMATION_PROGRESS") {
      if (message.statusText !== undefined) {
        setConnectionStatus("active", message.statusText);
      }
      if (message.stats) {
        if (message.stats.completed !== undefined) {
          statsCompleted.textContent = message.stats.completed;
          chrome.storage.local.set({ [STORAGE_KEYS.statsCompleted]: message.stats.completed });
        }
        if (message.stats.failed !== undefined) {
          statsFailed.textContent = message.stats.failed;
          chrome.storage.local.set({ [STORAGE_KEYS.statsFailed]: message.stats.failed });
        }
      }
      if (message.remainingPromptsText !== undefined) {
        promptsInput.value = message.remainingPromptsText;
        chrome.storage.local.set({ [STORAGE_KEYS.promptsText]: message.remainingPromptsText });
        updatePromptCount();
      }
      if (message.failedPromptsText !== undefined) {
        failedPromptsInput.value = message.failedPromptsText;
        chrome.storage.local.set({ [STORAGE_KEYS.failedPromptsText]: message.failedPromptsText });
      }
      
      // Auto shutdown if queue is empty
      if (message.isDone) {
        cleanupStopState();
      }
    }
  });

  // Initial Load
  loadFromStorage();
});
