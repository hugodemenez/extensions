import { context as Context, getOctokit } from "@actions/github";
import * as Core from "@actions/core";
import { PullRequestEvent } from "@octokit/webhooks-types";

type API = {
  github: ReturnType<typeof getOctokit>;
  context: typeof Context & {
    payload: PullRequestEvent;
  };
  core: typeof Core;
};

export default async ({ github, context }: API) => {
  const assignReadyForReviewTo = "pernielsentikaer";
  const assignReadyForReviewToWindows = "mathieudutour";

  // Previous expectations: Due to our current reduced availability, the initial review may take up to 10 business days.
  const expectations = "You can expect an initial review within five business days.";

  // Optimized label helper: lazily fetch labels once per run and reuse.
  let _labelsMemo: string[] | null = null;
  async function _fetchLabelsOnce(): Promise<string[]> {
    if (_labelsMemo !== null) return _labelsMemo;
    try {
      const { data } = await github.rest.issues.listLabelsOnIssue({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      });
      _labelsMemo = (data as { name: string }[]).map((l) => l.name);
      return _labelsMemo;
    } catch (err) {
      console.warn("Could not fetch labels:", err);
      _labelsMemo = [];
      return _labelsMemo;
    }
  }

  /**
   * Read or sync platform labels in an optimized way:
   * - If `platforms` is omitted, returns the current platform labels (read-only).
   * - If `platforms` is provided, synchronizes platform labels to match (add/remove as needed) and returns final platform labels.
   */
  async function syncPlatformLabels(platforms?: string[]): Promise<string[]> {
    const currentNames = await _fetchLabelsOnce();
    const existingPlatformLabels = currentNames.filter((n) => n.startsWith("platform: "));

    // Read-only mode: just return the platform labels
    if (!platforms) {
      return existingPlatformLabels;
    }

    const newPlatformLabels = platforms.map((p) => `platform: ${p}`);
    const labelsToRemove = existingPlatformLabels.filter((l) => !newPlatformLabels.includes(l));
    const labelsToAdd = newPlatformLabels.filter((l) => !existingPlatformLabels.includes(l));

    // Remove labels that are no longer needed
    for (const labelToRemove of labelsToRemove) {
      try {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          name: labelToRemove,
        });
        _labelsMemo = (_labelsMemo ?? []).filter((n) => n !== labelToRemove);
        console.log(`Removed platform label: ${labelToRemove}`);
      } catch (error) {
        console.error(`Failed to remove platform label ${labelToRemove}:`, error);
      }
    }

    // Add only the new labels that don't already exist
    if (labelsToAdd.length > 0) {
      try {
        await github.rest.issues.addLabels({
          issue_number: context.issue.number,
          owner: context.repo.owner,
          repo: context.repo.repo,
          labels: labelsToAdd,
        });
        _labelsMemo = Array.from(new Set([...(_labelsMemo ?? []), ...labelsToAdd]));
        console.log(`Added platform labels: ${labelsToAdd.join(", ")}`);
      } catch (error) {
        console.error(`Failed to add platform labels:`, error);
      }
    }

    // Log when no changes needed
    if (labelsToRemove.length === 0 && labelsToAdd.length === 0) {
      console.log(`No platform label changes needed. Current labels: ${existingPlatformLabels.join(", ")}`);
    }

    const finalPlatformLabels = (_labelsMemo ?? []).filter((n) => n.startsWith("platform: "));
    return finalPlatformLabels;
  }

  // When PR is marked ready for review, assign reviewers based on platform
  if (context.payload.action === "ready_for_review" && !context.payload.pull_request.draft) {
    let platformNames: string[] = [];
    try {
      const currentPlatformLabels = await syncPlatformLabels();
      platformNames = currentPlatformLabels.map((l) => l.replace(/^platform:\s*/i, "").toLowerCase());

      const assigneesSet = new Set<string>([assignReadyForReviewTo]);
      if (platformNames.includes("windows")) {
        assigneesSet.add(assignReadyForReviewToWindows);
      }

      const assignees = Array.from(assigneesSet);

      await github.rest.issues.addAssignees({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        assignees,
      });
      console.log(`Successfully assigned PR to ${assignees.join(", ")}`);
    } catch (error) {
      const extraAssignee = platformNames.includes("windows") ? ` and ${assignReadyForReviewToWindows}` : '';
      console.error(`Failed to assign PR to ${assignReadyForReviewTo}${extraAssignee}:`, error);
    }
  }

  if (!process.env.CHANGED_EXTENSIONS) {
    console.log("No changed extensions");
    return;
  }

  const touchedExtensions = new Set(
    process.env.CHANGED_EXTENSIONS.split(",")
      .map((x) => x.split("/").at(-2))
      .filter(Boolean) as string[]
  );
  console.log("changed extensions", touchedExtensions);

  if (touchedExtensions.size > 1) {
    console.log("We only notify people when updating a single extension");
    return;
  }

  const codeowners = await getCodeOwners({ github, context });
  const sender = context.payload.sender.login;

  if (sender === "raycastbot") {
    console.log("We don't notify people when raycastbot is doing its stuff (usually merging the PR)");
    return;
  }

  const opts = github.rest.issues.listForRepo.endpoint.merge({
    ...context.issue,
    creator: sender,
    state: "all",
  });
  const issues = await github.paginate<{
    owner: string;
    repo: string;
    number: string | number;
    pull_request: boolean;
  }>(opts);

  const isFirstContribution = issues.every((issue) => issue.number === context.issue.number || !issue.pull_request);

  for (const extensionFolder of touchedExtensions) {
    const owners = codeowners[`/extensions/${extensionFolder}`];

    let aiFilesOrToolsExist = false;
    let platforms: string[] = ["macOS"];

    if (!owners) {
      // it's a new extension
      console.log(`cannot find existing extension ${extensionFolder}`);

      await github.rest.issues.addLabels({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        labels: ["new extension"],
      });

      aiFilesOrToolsExist = await checkForAiInPullRequestDiff(extensionFolder, { github, context });

      if (aiFilesOrToolsExist) {
        console.log(`adding AI Extension label because ai files or tools exist for ${extensionFolder}`);
        await github.rest.issues.addLabels({
          issue_number: context.issue.number,
          owner: context.repo.owner,
          repo: context.repo.repo,
          labels: ["AI Extension"],
        });
      }

      const platformsFromPR = await getPlatformsFromPullRequestDiff(extensionFolder, { github, context });
      platforms = platformsFromPR.length > 0 ? platformsFromPR : ["macOS"];

      await syncPlatformLabels(platforms);

      await comment({
        github,
        context,
        comment: `Congratulations on your new Raycast extension! :rocket:\\n\\n${expectations}\\n\\nOnce the PR is approved and merged, the extension will be available on our Store.`,
      });
      return;
    }

    await github.rest.issues.addLabels({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      labels: ["extension fix / improvement", await extensionLabel(extensionFolder, { github, context })],
    });

    // Check package.json for tools and platforms
    try {
      const packageJson = await getGitHubFile(`extensions/${extensionFolder}/package.json`, { github, context });
      const packageJsonObj = JSON.parse(packageJson);

      aiFilesOrToolsExist = !!packageJsonObj.tools;
      
      if (packageJsonObj.platforms && Array.isArray(packageJsonObj.platforms)) {
        platforms = packageJsonObj.platforms;
      }
    } catch {
      console.log(`No package.json tools for ${extensionFolder}`);
    }

    // Check if package.json was modified in PR (overrides existing platforms)
    const platformsFromPR = await getPlatformsFromPullRequestDiff(extensionFolder, { github, context });
    if (platformsFromPR.length > 0) {
      platforms = platformsFromPR;
      console.log(`Using platforms from PR diff: ${platforms.join(", ")}`);
    }

    // Only check AI files if no tools found in package.json
    if (!aiFilesOrToolsExist) {
      const aiFileNames = ["ai.json", "ai.yaml", "ai.json5"];
      for (const aiFile of aiFileNames) {
        try {
          await getGitHubFile(`extensions/${extensionFolder}/${aiFile}`, { github, context });
          aiFilesOrToolsExist = true;
          console.log(`Found ${aiFile} for ${extensionFolder}`);
          break;
        } catch {
          console.log(`No ${aiFile} for ${extensionFolder}`);
        }
      }
    }

    if (!aiFilesOrToolsExist) {
      aiFilesOrToolsExist = await checkForAiInPullRequestDiff(extensionFolder, { github, context });
    }

    if (aiFilesOrToolsExist) {
      await github.rest.issues.addLabels({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        labels: ["AI Extension"],
      });
    }

    await syncPlatformLabels(platforms);

    if (!owners.length) {
      console.log("no maintainer for this extension");
      await comment({
        github,
        context,
        comment: `Thank you for your ${isFirstContribution ? "first " : ""} contribution! :tada:\n\nThis is especially helpful since there were no maintainers for this extension :pray:\\n\\n${expectations}`,
      });
    }

    if (owners[0] === sender) {
      await github.rest.issues.addLabels({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        labels: ["OP is author"],
      });

      await comment({
        github,
        context,
        comment: `Thank you for the update! :tada:\\n\\n${expectations}`,
      });
      return;
    }

    if (owners.indexOf(sender) !== -1) {
      await github.rest.issues.addLabels({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        labels: ["OP is contributor"],
      });
    }

    await comment({
      github,
      context,
      comment: `Thank you for your ${isFirstContribution ? "first " : ""} contribution! :tada:\n\n🔔 ${[...new Set(owners.filter((x) => x !== sender))]
        .map((x) => `@${x}`)
        .join(" ")} you might want to have a look.\\n\\nYou can use [this guide](https://developers.raycast.com/basics/review-pullrequest) to learn how to check out the Pull Request locally in order to test it.\\n\\n${expectations}`,
    });

    return;
  }
};

async function getCodeOwners({ github, context }: Pick<API, "github" | "context">) {
  const codeowners = await getGitHubFile(".github/CODEOWNERS", { github, context });
  const regex = /(\/extensions\/[\w-]+) +(.*)/g;
  const matches = codeowners.matchAll(regex);

  return Array.from(matches).reduce<{ [key: string]: string[] }>((prev, match) => {
    prev[match[1]] = match[2]
      .split(" ")
      .map((x) => x.replace(/^@/, ""))
      .filter((x) => !!x);
    return prev;
  }, {});
}

async function getExtensionName2Folder({ github, context }: Pick<API, "github" | "context">) {
  const file = await getGitHubFile(".github/extensionName2Folder.json", { github, context });
  return JSON.parse(file) as { [key: string]: string };
}

async function getGitHubFile(path: string, { github, context }: Pick<API, "github" | "context">) {
  const { data } = await github.rest.repos.getContent({
    mediaType: {
      format: "raw",
    },
    owner: context.repo.owner,
    repo: context.repo.repo,
    path,
  });

  // @ts-ignore
  return data as string;
}

async function checkForAiInPullRequestDiff(
  extensionFolder: string,
  { github, context }: Pick<API, "github" | "context">
) {
  const { data: files } = await github.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.issue.number,
  });

  let aiFilesOrToolsExist: boolean = false;

  for (const file of files) {
    const filePath = file.filename;

    if (!filePath.startsWith(`extensions/${extensionFolder}/`)) {
      continue;
    }

    if (filePath === `extensions/${extensionFolder}/package.json`) {
      try {
        if (file.status === "added" || file.status === "modified") {
          const { data: content } = await github.rest.repos.getContent({
            mediaType: {
              format: "raw",
            },
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: filePath,
            ref: context.payload.pull_request.head.sha,
          });

          const packageJsonObj = JSON.parse(content as unknown as string);
          aiFilesOrToolsExist = !!packageJsonObj.tools;
        }
      } catch {
        console.log(`Could not parse package.json for ${extensionFolder}`);
      }
    }

    if (file.status === "added" || file.status === "modified") {
      const aiFiles = ["ai.json", "ai.yaml", "ai.json5"];
      if (aiFiles.some((filename) => filePath === `extensions/${extensionFolder}/${filename}`)) {
        aiFilesOrToolsExist = true;
      }
    }
  }

  return aiFilesOrToolsExist;
}

async function getPlatformsFromPullRequestDiff(
  extensionFolder: string,
  { github, context }: Pick<API, "github" | "context">
): Promise<string[]> {
  const { data: files } = await github.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.issue.number,
  });

  for (const file of files) {
    const filePath = file.filename;

    if (!filePath.startsWith(`extensions/${extensionFolder}/`)) {
      continue;
    }

    if (filePath === `extensions/${extensionFolder}/package.json`) {
      try {
        if (file.status === "added" || file.status === "modified") {
          const { data: content } = await github.rest.repos.getContent({
            mediaType: {
              format: "raw",
            },
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: filePath,
            ref: context.payload.pull_request.head.sha,
          });

          const packageJsonObj = JSON.parse(content as unknown as string);

          if (packageJsonObj.platforms && Array.isArray(packageJsonObj.platforms)) {
            return packageJsonObj.platforms;
          }
        }
      } catch {
        console.log(`Could not parse package.json for ${extensionFolder}`);
      }
    }
  }

  return [];
}

async function comment({ github, context, comment: commentText }: Pick<API, "github" | "context"> & { comment: string }) {
  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  });

  const botComment = comments.find((comment) => comment.user?.login === "raycastbot");

  if (botComment) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: botComment.id,
      body: commentText,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: commentText,
    });
  }
}

async function extensionLabel(extensionFolder: string, api: Pick<API, "github" | "context">) {
  const extensionName2Folder = await getExtensionName2Folder(api);
  const extension = Object.values(extensionName2Folder).find(([name, folder]) => folder === extensionFolder)?.[0];

  let label;

  if (extension) {
    const names = Object.keys(extensionName2Folder).map((x) => x.split("/")[1]);
    const multipleExtensionsWithTheSameName = names.filter((x) => x === extension).length > 1;
    label = `extension: ${multipleExtensionsWithTheSameName ? extension : extension?.split("/")[1]}`;
  } else {
    label = `extension: ${extensionFolder}`;
  }

  return label.length > 50 ? label.substring(0, 49) + "…" : label;
}
