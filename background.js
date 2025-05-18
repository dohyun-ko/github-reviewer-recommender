const CACHE_TTL_MINUTES_SUGGESTIONS = 15;
const CACHE_TTL_MINUTES_PR_DETAILS = 60;

chrome.runtime.onInstalled.addListener(() => {
  console.log("Reviewer Recommender installed/updated.");

  chrome.storage.sync.get(["githubPAT"], function (result) {
    if (!result.githubPAT) {
      console.log("GitHub PAT not found. Opening options page for setup.");
      chrome.runtime.openOptionsPage();
    }
  });
});

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["githubPAT"], function (result) {
      if (chrome.runtime.lastError) {
        reject(
          new Error("Error retrieving PAT: " + chrome.runtime.lastError.message)
        );
      } else if (result.githubPAT && result.githubPAT.trim() !== "") {
        resolve(result.githubPAT.trim());
      } else {
        reject(
          new Error(
            "GitHub PAT not configured or is empty. Please set it in the extension options."
          )
        );
      }
    });
  });
}

async function getFromCache(key) {
  try {
    const result = await chrome.storage.local.get(key);
    if (result && result[key]) {
      const cachedItem = result[key];
      if (cachedItem.expiration > Date.now()) {
        return cachedItem.data;
      } else {
        console.log(`Cache EXPIRED for key: ${key}`);
        await chrome.storage.local.remove(key);
      }
    }
  } catch (error) {
    console.error(`Error getting from cache for key ${key}:`, error);
  }
  return null;
}

async function setToCache(key, data, ttlMinutes) {
  const expiration = Date.now() + ttlMinutes * 60 * 1000;
  try {
    await chrome.storage.local.set({ [key]: { data, expiration } });
  } catch (error) {
    console.error(`Error setting to cache for key ${key}:`, error);
  }
}

async function fetchPrDetails(owner, repo, prNumber) {
  const authToken = await getAuthToken();
  const cacheKey = `pr_details_${owner}_${repo}_${prNumber}`;
  const cachedData = await getFromCache(cacheKey);
  if (cachedData) return cachedData;

  const prDetailsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  console.log(`API: Fetching PR details for ${owner}/${repo}#${prNumber}`);
  const response = await fetch(prDetailsUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${authToken}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `API Error fetching PR details for ${owner}/${repo}#${prNumber}: ${response.status} ${errorText}`
    );
    throw new Error(
      `Failed to fetch PR details (${response.status}). Ensure PAT is valid and has repo scope.`
    );
  }
  const prData = await response.json();
  await setToCache(cacheKey, prData, CACHE_TTL_MINUTES_PR_DETAILS);
  return prData;
}

async function fetchSubmittedReviews(owner, repo, prNumber, authToken) {
  const submittedReviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
  console.log(
    `API: Fetching submitted reviews for ${owner}/${repo}#${prNumber}`
  );
  try {
    const response = await fetch(submittedReviewsUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${authToken}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `API Error fetching submitted reviews for ${owner}/${repo}#${prNumber}: ${response.status} ${errorText}`
      );
      // Return empty array on error to not block suggestion flow entirely
      return [];
    }
    const reviewsData = await response.json();
    if (reviewsData && Array.isArray(reviewsData)) {
      const prAuthorLogin = (await fetchPrDetails(owner, repo, prNumber))?.user
        ?.login;
      return reviewsData
        .map((review) => review.user && review.user.login)
        .filter(
          (login) =>
            login && login !== prAuthorLogin && !login.endsWith("[bot]")
        );
    }
    return [];
  } catch (error) {
    console.error(
      `Network/fetch error for submitted reviews ${owner}/${repo}#${prNumber}:`,
      error.message
    );
    return []; // Gracefully handle network errors
  }
}

// Listener for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPrDetailsAndSuggestIfOwnPR") {
    const { loggedInUser, owner, repo, prNumber } = request;
    if (!loggedInUser || !owner || !repo || !prNumber) {
      console.error("Missing parameters for getPrDetailsAndSuggestIfOwnPR.");
      sendResponse({
        error: "Missing parameters for operation.",
        suggestionsApplicable: false,
      });
      return false;
    }
    (async () => {
      try {
        const prData = await fetchPrDetails(owner, repo, prNumber);
        const actualPrAuthor = prData.user.login;
        if (loggedInUser === actualPrAuthor) {
          const authToken = await getAuthToken(); // Ensure authToken is available
          const suggestedReviewers = await fetchRecentReviewersViaSearch(
            owner,
            repo,
            actualPrAuthor
          );
          const submittedReviewerLogins = await fetchSubmittedReviews(
            owner,
            repo,
            prNumber,
            authToken
          );
          sendResponse({
            suggestionsApplicable: true,
            reviewers: suggestedReviewers,
            currentRequestedReviewers: prData.requested_reviewers || [], // Ensure it's an array
            submittedReviewerLogins: submittedReviewerLogins || [], // Ensure it's an array
          });
        } else {
          sendResponse({ suggestionsApplicable: false });
        }
      } catch (error) {
        console.error(
          `Error in getPrDetailsAndSuggestIfOwnPR for ${owner}/${repo}#${prNumber}:`,
          error.message
        );
        sendResponse({ error: error.message, suggestionsApplicable: false });
      }
    })();
    return true;
  } else if (request.action === "getRecentReviewers") {
    const { author: prAuthor, owner, repo } = request;
    if (!owner || !repo || !prAuthor) {
      console.error(
        "Owner, repo, or prAuthor not provided for getRecentReviewers."
      );
      sendResponse({
        reviewers: [],
        error: "Missing repository/author information.",
      });
      return false;
    }
    (async () => {
      try {
        const cacheKey = `suggestions_direct_${owner}_${repo}_${prAuthor}`;
        const cachedSuggestions = await getFromCache(cacheKey);
        if (cachedSuggestions) {
          sendResponse({ reviewers: cachedSuggestions });
          return;
        }
        console.log(
          `API: Fetching direct suggestions for ${prAuthor} in ${owner}/${repo}`
        );
        const reviewers = await fetchRecentReviewersViaSearch(
          owner,
          repo,
          prAuthor
        );
        await setToCache(cacheKey, reviewers, CACHE_TTL_MINUTES_SUGGESTIONS);
        sendResponse({ reviewers });
      } catch (error) {
        console.error(
          `Error fetching direct suggestions for ${prAuthor} in ${owner}/${repo}:`,
          error.message
        );
        sendResponse({ reviewers: [], error: error.message });
      }
    })();
    return true;
  } else if (request.action === "requestReview") {
    const { owner, repo, prNumber, reviewerLogin } = request;
    if (!owner || !repo || !prNumber || !reviewerLogin) {
      console.error("Missing parameters for requestReview action.");
      sendResponse({
        success: false,
        error: "Missing parameters for review request.",
      });
      return false;
    }
    (async () => {
      try {
        const responseData = await postReviewRequest(
          owner,
          repo,
          prNumber,
          reviewerLogin
        );
        sendResponse(responseData);
      } catch (error) {
        console.error(
          `Error posting review request for ${reviewerLogin} on ${owner}/${repo}#${prNumber}:`,
          error.message
        );
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

async function fetchRecentReviewersViaSearch(owner, repo, prAuthor) {
  const authToken = await getAuthToken();
  const cacheKey = `suggestions_${owner}_${repo}_${prAuthor}`;
  const cachedData = await getFromCache(cacheKey);
  if (cachedData) return cachedData;

  console.log(
    `API: Fetching reviewer suggestions for ${prAuthor} in ${owner}/${repo}`
  );
  const RECENT_PRS_COUNT = 5;
  const searchQuery = `repo:${owner}/${repo} is:pr is:merged author:${prAuthor} sort:updated-desc`;
  const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(
    searchQuery
  )}&per_page=${RECENT_PRS_COUNT}`;

  const searchResponse = await fetch(searchUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${authToken}`,
    },
  });
  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    console.error(
      `API Error during PR search for suggestions (${owner}/${repo}, author ${prAuthor}): ${searchResponse.status} ${errorText}`
    );
    throw new Error(
      `GitHub Search API error (${searchResponse.status}). Check PAT scopes.`
    );
  }
  const searchResult = await searchResponse.json();
  if (!searchResult.items || searchResult.items.length === 0) {
    await setToCache(cacheKey, [], CACHE_TTL_MINUTES_SUGGESTIONS);
    return [];
  }
  const reviewerLogins = new Set();
  await Promise.all(
    searchResult.items.map(async (prItem) => {
      const prNumberItem = prItem.number;
      if (!prItem.pull_request) return;

      const requestedReviewersUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumberItem}/requested_reviewers`;
      try {
        const reviewersResponse = await fetch(requestedReviewersUrl, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (reviewersResponse.ok) {
          const d = await reviewersResponse.json();
          if (d.users)
            d.users.forEach((u) => {
              if (u.login !== prAuthor) reviewerLogins.add(u.login);
            });
        } else {
          console.warn(
            `API Warning: Could not fetch requested reviewers for PR #${prNumberItem} (${reviewersResponse.status})`
          );
        }
      } catch (e) {
        console.warn(
          `Network/fetch error for requested reviewers PR #${prNumberItem}:`,
          e.message
        );
      }

      const submittedReviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumberItem}/reviews`;
      try {
        const submittedReviewsResponse = await fetch(submittedReviewsUrl, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (submittedReviewsResponse.ok) {
          const d = await submittedReviewsResponse.json();
          if (d && Array.isArray(d))
            d.forEach((r) => {
              if (r.user && r.user.login !== prAuthor)
                reviewerLogins.add(r.user.login);
            });
        } else {
          console.warn(
            `API Warning: Could not fetch submitted reviews for PR #${prNumberItem} (${submittedReviewsResponse.status})`
          );
        }
      } catch (e) {
        console.warn(
          `Network/fetch error for submitted reviews PR #${prNumberItem}:`,
          e.message
        );
      }
    })
  );

  const reviewerLoginsArrayWithoutBots = Array.from(reviewerLogins).filter(
    (login) => !login.endsWith("[bot]")
  );
  const suggestedReviewers = reviewerLoginsArrayWithoutBots.map((login) => ({
    login: login,
    avatar_url: `https://github.com/${login}.png?size=40`,
  }));

  await setToCache(cacheKey, suggestedReviewers, CACHE_TTL_MINUTES_SUGGESTIONS);
  return suggestedReviewers;
}

async function postReviewRequest(owner, repo, prNumber, reviewerLogin) {
  const authToken = await getAuthToken();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`;
  console.log(
    `API: Posting review request for ${reviewerLogin} on ${owner}/${repo}#${prNumber}`
  );
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reviewers: [reviewerLogin] }),
  });
  if (response.ok) {
    const responseData = await response.json();
    const isRequested = responseData.requested_reviewers?.some(
      (r) => r.login === reviewerLogin
    );
    if (isRequested) {
      return { success: true };
    } else {
      console.warn(
        `Review request for ${reviewerLogin} on ${owner}/${repo}#${prNumber} seemed successful (status ${response.status}) but user not found in response list.`
      );
      return {
        success: false,
        error: "Reviewer not found in updated list post-request.",
      };
    }
  } else {
    const errorBody = await response.text();
    console.error(
      `API Error requesting review for ${reviewerLogin} on ${owner}/${repo}#${prNumber}: ${response.status} ${errorBody}`
    );
    throw new Error(
      `Failed to request review (${response.status}). Ensure PAT is valid and has repo scope.`
    );
  }
}
