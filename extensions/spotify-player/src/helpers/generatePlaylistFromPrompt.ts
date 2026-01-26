import { AI, Toast, showToast } from "@raycast/api";
import { cleanAIResponse } from "./cleanAIResponse";
import { resolveTracksOnSpotify } from "./resolveTracksOnSpotify";
import { Playlist } from "../generatePlaylist";

export async function generatePlaylistFromPrompt(userPrompt: string, history?: Playlist[]): Promise<Playlist> {
  const promptWithContext = history
    ? `CONTEXT:
already generated ${history.length} playlist: ${history
        .slice(-5)
        .map(
          (playlist, index) =>
            `[${index + 1}] ASKED: "${playlist.prompt}"
SAMPLE SONGS: ${playlist.tracks
              .slice(0, 3)
              .map((track) => `"${track.name}" by ${track.artists?.map((artist) => artist.name).join(", ")}`)}`,
        )
        .join(", ")}].
TUNE WITH INSTRUCTIONS: "${userPrompt}"`
    : `USER ASKED FOR: ${userPrompt}`;

  console.log("Prompt with context:", promptWithContext);

  const playlistSample = {
    name: "Playlist Name",
    description: "A brief description of the playlist.",
    tracks: [
      { name: "Song Title 1", artists: ["Artist 1, Artist 2"] },
      { name: "Song Title 2", artists: ["Artist 1"] },
    ],
  };

  const prompt = `You are a Playlist generator.
You have access to the internet to make research
CREATE 10 songs playlist 
"${promptWithContext}".
Return ONLY minified JSON:
${JSON.stringify(playlistSample)}
No markdown, no explanation.`;

  const answer = AI.ask(prompt, { model: AI.Model["Perplexity_Sonar"] });

  await showToast({
    style: Toast.Style.Animated,
    title: history ? "Tuning playlist with AI..." : "Generating playlist with AI...",
  });

  const data = await answer;

  console.log("Raw AI Response:", data);

  // Clean AI response
  const jsonString = cleanAIResponse(data);
  console.log("Cleaned AI Response:", jsonString);

  // Parse JSON string
  const playlist = JSON.parse(jsonString);

  playlist.prompt = userPrompt;
  const spotifyTracks = await resolveTracksOnSpotify(playlist.tracks);

  await showToast({
    style: Toast.Style.Success,
    title: history ? "Playlist tuned" : "Playlist generated",
    message: `"${playlist.name}" - ${spotifyTracks.filter(Boolean).length} songs`,
  });

  return {
    name: playlist.name,
    description: playlist.description,
    tracks: spotifyTracks,
    prompt: userPrompt,
  };
}
