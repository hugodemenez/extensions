import { closeMainWindow, showHUD } from "@raycast/api";
import { runJSInYouTubeMusicTab } from "./utils";

export default async () => {
  try {
    const result = await runJSInYouTubeMusicTab(`
      (() => {
        const isYTM = location.hostname.includes("music.youtube.com");

        if (isYTM) {
          const likeButton = document.querySelector(
            "ytmusic-like-button-renderer[like-status='LIKE'] #button-shape-like[aria-pressed='true'] > button"
          );
          if (likeButton) {
            likeButton.click();
            return "ytmusic-removed";
          }
          return "ytmusic-none";
        }

        // YouTube - new UI: segmented-like-dislike-button-view-model
        const newLikeButton = document.querySelector(
          "segmented-like-dislike-button-view-model like-button-view-model button[aria-pressed='true']"
        );
        if (newLikeButton) {
          newLikeButton.click();
          return "youtube-removed";
        }

        return "youtube-none";
      })();
    `);

    const messages = {
      "ytmusic-removed": "👍🏻 Removed Like (YT Music)",
      "ytmusic-none": "⚠️ No Like set (YT Music)",
      "youtube-removed": "👍🏻 Removed Like (YouTube)",
      "youtube-none": "⚠️ No Like set (YouTube)",
    };
    if (messages[result as keyof typeof messages]) {
      await showHUD(messages[result as keyof typeof messages]);
    }

    await closeMainWindow();
  } catch (e) {
    console.error(e);
    await showHUD("❌ Failed to remove like");
  }
};
