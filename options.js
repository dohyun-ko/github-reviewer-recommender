document.addEventListener("DOMContentLoaded", function () {
  const patInput = document.getElementById("patInput");
  const saveButton = document.getElementById("saveButton");
  const statusMessage = document.getElementById("statusMessage");

  // Load the saved PAT when the options page opens
  chrome.storage.sync.get(["githubPAT"], function (result) {
    if (result.githubPAT) {
      patInput.value = result.githubPAT;
    }
  });

  saveButton.addEventListener("click", function () {
    const pat = patInput.value.trim();
    if (pat) {
      chrome.storage.sync.set({ githubPAT: pat }, function () {
        if (chrome.runtime.lastError) {
          statusMessage.textContent =
            "Error saving token: " + chrome.runtime.lastError.message;
          statusMessage.style.color = "red";
        } else {
          statusMessage.textContent = "Token saved successfully!";
          statusMessage.style.color = "green";
          setTimeout(() => {
            statusMessage.textContent = "";
          }, 3000);
        }
      });
    } else {
      // Optionally, clear the stored token if input is empty
      chrome.storage.sync.remove("githubPAT", function () {
        if (chrome.runtime.lastError) {
          statusMessage.textContent =
            "Error clearing token: " + chrome.runtime.lastError.message;
          statusMessage.style.color = "red";
        } else {
          statusMessage.textContent =
            "Token cleared. Please enter a new token or the extension may not work.";
          statusMessage.style.color = "orange";
          setTimeout(() => {
            statusMessage.textContent = "";
          }, 4000);
        }
      });
    }
  });
});
