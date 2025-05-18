# GitHub Reviewer Recommender ✨

**A Chrome extension that provides reviewer suggestions on GitHub Pull Request pages based on repository history.**

![Placeholder GIF: Extension in action on GitHub](placeholder_screenshot_1.gif)
_(GIF: Extension UI appearing, suggesting reviewers, user clicks "Request")_

## Purpose

Selecting appropriate reviewers for GitHub Pull Requests can be manual and time-consuming. This extension aims to simplify this by suggesting relevant reviewers based on recent activity within the repository.

## Functionality

The extension analyzes recent repository history to identify and suggest potential reviewers for your authored Pull Requests, displaying them in the GitHub sidebar. Users can then directly request reviews from these suggestions.

## Key Feature

- **Contextual Suggestions:** Identifies potential reviewers by analyzing recently merged pull requests, their actual reviewers, and their requested reviewers within the same repository. Suggestions are displayed only on PRs authored by the logged-in user.

![Placeholder Screenshot: Extension UI details](placeholder_screenshot_2.png)
_(Screenshot: Reviewer list, avatars, "Request" / "Request All" buttons)_

## How It Works

1.  The extension activates on Pull Request pages authored by the current user.
2.  It fetches data on recently merged PRs in the repository, along with their reviewers and requested reviewers (excluding the user's own PRs).
3.  A unique list of potential reviewers is compiled and displayed in the PR sidebar.
4.  Review requests can be sent to suggested individuals via the GitHub API, using a configured Personal Access Token (PAT).
5.  API responses are cached to optimize performance and manage API rate limits.

## Installation and Configuration

1.  **Installation:**
    - Clone or download this repository.
    - Navigate to `chrome://extensions` in Chrome and enable "Developer mode".
    - Click "Load unpacked" and select the extension's directory.
2.  **Personal Access Token (PAT) Setup:**
    - A GitHub PAT with `repo` or `public_repo` scope is required for API calls.
    - The extension will open its options page on first install if no PAT is found. Alternatively, right-click the extension icon and select "Options".
    - Paste your PAT into the options page and save.

## Contributing

Contributions, issues, and feature requests are welcome.

---

_This extension is not affiliated with GitHub._
