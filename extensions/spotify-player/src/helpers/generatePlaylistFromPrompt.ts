import { AI, Toast, showToast } from "@raycast/api";
import { TrackObject } from "./spotify.api";
import { cleanAIResponse } from "./cleanAIResponse";
import { resolveTracksOnSpotify } from "./resolveTracksOnSpotify";

export type Playlist = {
  name: string;
  description: string;
  tracks: TrackObject[];
  prompt: string;
};

export async function generatePlaylistFromPrompt(
  userPrompt: string,
  tune?: string,
  history?: Playlist[],
): Promise<Playlist> {
  const prompt = tune
    ? `Previous playlist: [${history?.map((playlist) => `"${playlist.prompt}"`).join(", ")}]. Modify with: "${tune}"`
    : userPrompt;

  const answer = AI.ask(
    `Find 20 spotify tracks based on "${prompt}". Return ONLY minified JSON:
{"name": "<Playlist name>", "description": "<Description>", "tracks": [{"name": "<Exact Spotify song title>", "artists": "<Artists>"}]}
Use exact Spotify song/artist names. No markdown, no explanation.`,
    { model: AI.Model["Perplexity_Sonar"] },
  );

  await showToast({
    style: Toast.Style.Animated,
    title: tune ? "Tuning playlist with AI..." : "Generating playlist with AI...",
  });

  const data = await answer;
  const jsonString = cleanAIResponse(data);
  const playlist = JSON.parse(jsonString);
  playlist.prompt = userPrompt;
  console.log("AI Playlist Response:", JSON.stringify(playlist));
  const spotifyTracks = await resolveTracksOnSpotify(playlist.tracks);

  await showToast({
    style: Toast.Style.Success,
    title: tune ? "Playlist tuned" : "Playlist generated",
    message: `"${playlist.name}" - ${spotifyTracks.filter(Boolean).length} songs`,
  });

  return {
    name: playlist.name,
    description: playlist.description,
    tracks: spotifyTracks,
    prompt: userPrompt,
  };
}
