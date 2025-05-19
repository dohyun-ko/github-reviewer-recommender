function getLoggedInUser() {
  const loggedInUserMetaTag = document.querySelector(
    'meta[name="octolytics-actor-login"]'
  );
  if (loggedInUserMetaTag) {
    return loggedInUserMetaTag.content;
  }
  console.warn("Could not determine logged-in GitHub user.");
  return null;
}

function getRepoInfo() {
  const pathParts = window.location.pathname.split("/");
  if (pathParts.length >= 5 && pathParts[3] === "pull") {
    return { owner: pathParts[1], repo: pathParts[2], prNumber: pathParts[4] };
  }
  console.warn(
    "Could not determine repository owner, name, or PR number from URL."
  );
  return null;
}

function displayReviewerSuggestions(
  reviewers,
  message = null,
  currentRequestedReviewers = [],
  submittedReviewerLogins = []
) {
  const sidebar = document.querySelector("#partial-discussion-sidebar");
  if (!sidebar) {
    console.warn("Sidebar not found, cannot display suggestions.");
    return;
  }
  let suggestionsContainer = document.getElementById(
    "reviewer-recommender-container"
  );
  if (suggestionsContainer) {
    suggestionsContainer.innerHTML = "";
  } else {
    suggestionsContainer = document.createElement("div");
    suggestionsContainer.id = "reviewer-recommender-container";
    const reviewersBlock = sidebar.querySelector(
      ".discussion-sidebar-item .js-issue-sidebar-form"
    );
    if (reviewersBlock) {
      reviewersBlock.parentNode.insertBefore(
        suggestionsContainer,
        reviewersBlock.nextSibling
      );
    } else {
      console.warn(
        "Could not find reviewersBlock to insert suggestions. Appending to sidebar."
      );
      sidebar.appendChild(suggestionsContainer);
    }
  }
  const titleWrapper = document.createElement("div");
  titleWrapper.className = "reviewer-title-wrapper";
  const title = document.createElement("h3");
  title.textContent = "Suggested Reviewers";
  title.className = "reviewer-recommender-title";
  titleWrapper.appendChild(title);
  suggestionsContainer.appendChild(titleWrapper);
  if (message) {
    const p = document.createElement("p");
    p.textContent = message;
    p.className = "reviewer-no-suggestions";
    suggestionsContainer.appendChild(p);
  } else if (reviewers && reviewers.length > 0) {
    if (reviewers.length > 1) {
      const requestAllButton = document.createElement("button");
      requestAllButton.textContent = "Request All";
      requestAllButton.className = "reviewer-request-all-btn";

      let requestAllDebounceTimer = null;
      const REQUEST_ALL_DEBOUNCE_DELAY = 500; // ms

      requestAllButton.onclick = function () {
        clearTimeout(requestAllDebounceTimer);
        requestAllDebounceTimer = setTimeout(() => {
          this.disabled = true;
          this.textContent = "Sending...";
          const individualRequestButtons =
            suggestionsContainer.querySelectorAll(
              ".reviewer-request-btn:not(:disabled)"
            );
          let clickCount = 0;
          individualRequestButtons.forEach((btn) => {
            if (!btn.disabled) {
              btn.click(); // This will trigger individual requests with their own logic
              clickCount++;
            }
          });

          // Update button text based on actual clicks initiated.
          // The individual buttons will handle their own state ("Requested!", "Error").
          if (clickCount > 0) {
            this.textContent = `Processing ${clickCount}...`;
            // We might need a more sophisticated way to know when all are truly done
            // For now, revert after a delay, assuming operations are relatively quick.
            setTimeout(() => {
              this.disabled = false;
              this.textContent = "Request All";
            }, 3000 + clickCount * 500); // Rough estimate for completion
          } else {
            this.textContent = "Done (No new requests)";
            setTimeout(() => {
              this.disabled = false;
              this.textContent = "Request All";
            }, 2000);
          }
        }, REQUEST_ALL_DEBOUNCE_DELAY);
      };
      titleWrapper.appendChild(requestAllButton);
    }
    const ul = document.createElement("ul");
    ul.className = "reviewer-list";
    reviewers.forEach((reviewer) => {
      const li = document.createElement("li");
      li.className = "reviewer-list-item";
      const reviewerInfoDiv = document.createElement("div");
      reviewerInfoDiv.className = "reviewer-user-info";
      const img = document.createElement("img");
      img.src = reviewer.avatar_url;
      img.alt = reviewer.login;
      img.className = "reviewer-avatar";
      const span = document.createElement("span");
      span.textContent = reviewer.login;
      span.className = "reviewer-login";
      reviewerInfoDiv.appendChild(img);
      reviewerInfoDiv.appendChild(span);
      const requestButton = document.createElement("button");
      requestButton.textContent = "Request";
      requestButton.className = "reviewer-request-btn";
      requestButton.setAttribute("data-login", reviewer.login);

      const isAlreadyRequested = currentRequestedReviewers.some(
        (r) => r.login === reviewer.login
      );
      const hasAlreadyReviewed = submittedReviewerLogins.includes(
        reviewer.login
      );

      if (isAlreadyRequested) {
        requestButton.disabled = true;
        requestButton.textContent = "Requested";
        requestButton.classList.add("requested");
      } else if (hasAlreadyReviewed) {
        requestButton.disabled = true;
        requestButton.textContent = "Reviewed";
        requestButton.classList.add("reviewed");
      }

      requestButton.onclick = function () {
        const repoInfoForRequest = getRepoInfo();
        if (!repoInfoForRequest || !repoInfoForRequest.prNumber) {
          console.error("Could not get PR info to request review.");
          alert("Error: Could not determine PR details for request.");
          return;
        }
        const currentUser = getLoggedInUser(); // Get current user for prAuthor
        if (!currentUser) {
          console.error(
            "Could not determine logged in user to attribute prAuthor for cache clearing."
          );
          // Optionally, alert the user or proceed without prAuthor, though cache clearing for suggestions might be skipped by background
        }

        requestButton.disabled = true;
        requestButton.textContent = "Requesting...";
        requestButton.classList.add("requesting");
        requestButton.classList.remove("requested");
        chrome.runtime.sendMessage(
          {
            action: "requestReview",
            owner: repoInfoForRequest.owner,
            repo: repoInfoForRequest.repo,
            prNumber: repoInfoForRequest.prNumber,
            reviewerLogin: reviewer.login,
            prAuthor: currentUser, // Pass prAuthor
          },
          (response) => {
            requestButton.classList.remove("requesting");
            if (chrome.runtime.lastError) {
              console.error(
                "Error sending review request message:",
                chrome.runtime.lastError.message
              );
              alert(`Failed to send request for ${reviewer.login}.`);
              requestButton.disabled = false;
              requestButton.textContent = "Request";
              return;
            }
            if (response && response.success) {
              requestButton.textContent = "Requested!";
              requestButton.classList.add("requested");
            } else {
              console.error(
                `Failed to request review from ${reviewer.login}: ${response?.error}`
              );
              alert(
                `Failed to request review from ${reviewer.login}. Error: ${
                  response?.error || "Unknown error"
                }`
              );
              requestButton.disabled = false;
              requestButton.textContent = "Request";
            }
          }
        );
      };
      li.appendChild(reviewerInfoDiv);
      li.appendChild(requestButton);
      ul.appendChild(li);
    });
    suggestionsContainer.appendChild(ul);
  } else {
    const p = document.createElement("p");
    p.textContent = "No recent reviewers found.";
    p.className = "reviewer-no-suggestions";
    suggestionsContainer.appendChild(p);
  }
}

let isMainLogicRunning = false;

function main() {
  if (isMainLogicRunning) {
    return;
  }
  isMainLogicRunning = true;

  if (window.location.href.includes("/pull/")) {
    const loggedInUser = getLoggedInUser();
    const repoInfo = getRepoInfo();
    if (
      loggedInUser &&
      repoInfo &&
      repoInfo.owner &&
      repoInfo.repo &&
      repoInfo.prNumber
    ) {
      const sidebar = document.querySelector("#partial-discussion-sidebar");
      if (!sidebar) {
        console.warn(
          "Sidebar not found, main() will retry via MutationObserver."
        );
        isMainLogicRunning = false;
        return;
      }
      chrome.runtime.sendMessage(
        {
          action: "getPrDetailsAndSuggestIfOwnPR",
          loggedInUser: loggedInUser,
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          prNumber: repoInfo.prNumber,
        },
        (response) => {
          try {
            if (chrome.runtime.lastError) {
              console.error(
                "Error sending message to background:",
                chrome.runtime.lastError.message
              );
              displayReviewerSuggestions(
                [],
                "Error communicating with extension."
              );
              return;
            }
            if (response.error) {
              console.error("Error from background script:", response.error);
              displayReviewerSuggestions([], `Error: ${response.error}`);
            } else if (response.suggestionsApplicable === false) {
              displayReviewerSuggestions(
                [],
                "Reviewer suggestions are only shown for your own pull requests."
              );
            } else if (response.reviewers) {
              if (response.reviewers.length > 0) {
                displayReviewerSuggestions(
                  response.reviewers,
                  null,
                  response.currentRequestedReviewers || [],
                  response.submittedReviewerLogins || []
                );
              } else {
                displayReviewerSuggestions(
                  [],
                  "No relevant reviewers found for your PR.",
                  response.currentRequestedReviewers || [],
                  response.submittedReviewerLogins || []
                );
              }
            } else {
              console.warn(
                "Unexpected response from background script for suggestions."
              );
              displayReviewerSuggestions([], "Could not load suggestions.");
            }
          } finally {
            isMainLogicRunning = false;
          }
        }
      );
    } else {
      console.warn(
        "Could not determine logged-in user or PR/repo info; or conditions not met for suggestions."
      );
      isMainLogicRunning = false;
    }
  } else {
    const existingContainer = document.getElementById(
      "reviewer-recommender-container"
    );
    if (existingContainer) {
      existingContainer.remove();
    }
    isMainLogicRunning = false;
  }
}

let currentUrl = window.location.href;
let debounceTimer = null;
const DEBOUNCE_DELAY_MS = 300;

function scheduleMainRun() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(main, DEBOUNCE_DELAY_MS);
}

function observeDOMChanges() {
  main();
  const observer = new MutationObserver((mutationsList, obs) => {
    let triggerMainCheck = false;
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      triggerMainCheck = true;
    } else if (window.location.href.includes("/pull/")) {
      if (!document.getElementById("reviewer-recommender-container")) {
        triggerMainCheck = true;
      }
    }
    if (triggerMainCheck) {
      scheduleMainRun();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", observeDOMChanges);
} else {
  observeDOMChanges();
}
