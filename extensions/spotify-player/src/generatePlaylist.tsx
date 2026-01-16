import { AI, Action, ActionPanel, Icon, LaunchProps, List, Toast, showToast, useNavigation } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import retry from "async-retry";
import { useEffect, useMemo, useState } from "react";
import { searchTracks } from "./api/searchTracks";
import { View } from "./components/View";
import TrackListItem from "./components/TrackListItem";
import { createPlaylist } from "./api/createPlaylist";
import { addToPlaylist } from "./api/addToPlaylist";
import { play } from "./api/play";
import { addToQueue } from "./api/addTrackToQueue";
import { skipToNext } from "./api/skipToNext";
import { TrackObject } from "./helpers/spotify.api";

type Playlist = {
  name: string;
  description: string;
  tracks: TrackObject[];
  prompt: string;
};

type ErrorState = {
  message: string;
  failedPrompt: string;
};

async function resolveTracksOnSpotify(aiTracks: TrackObject[]): Promise<TrackObject[]> {
  const tracks = await Promise.all(
    aiTracks.map(async (song) => {
      try {
        let response = await searchTracks(`track:${song.name} artist:${song.artists}`, 1);
        let track = response?.items?.[0];
        if (track) {
          console.log(`Found on Spotify: "${track.name}" by ${track.artists?.map((a) => a.name).join(", ")}`);
          return track;
        }
      } catch (error) {
        console.error(error);
      }
      console.log(`Didn't find "${song.name}" by ${song.artists} on Spotify`);
      return null;
    }),
  );

  // Check if any tracks were found on Spotify
  const validTracks = tracks.filter((t) => t !== null);
  if (validTracks.length === 0) {
    throw new Error("None of the suggested songs could be found on Spotify. Please try a different prompt.");
  }

  return validTracks;
}

function cleanAIResponse(data: string): string {
  let jsonString = data;

  // Remove markdown code blocks if present
  const codeBlockMatch = data.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  // Try to extract JSON object starting with { and ending with }
  const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in AI response");
  }

  jsonString = jsonMatch[0];

  // Clean up common issues in AI-generated JSON
  // Fix trailing commas before } or ]
  jsonString = jsonString.replace(/,\s*([}\]])/g, "$1");

  return jsonString;
}

async function generatePlaylistFromPrompt(userPrompt: string, tune?: string, history?: Playlist[]): Promise<Playlist> {
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

function TuneHistoryList({
  history,
  currentPlaylist,
  onSelect,
}: {
  history: Playlist[];
  currentPlaylist: Playlist | null;
  onSelect: (index: number) => void;
}) {
  const { pop } = useNavigation();
  const currentIndex = currentPlaylist ? history.indexOf(currentPlaylist) : -1;

  return (
    <List navigationTitle="Tune History">
      {history.map((version, index) => (
        <List.Item
          key={index}
          icon={index === currentIndex ? Icon.CheckCircle : Icon.Circle}
          title={version.name}
          subtitle={version.prompt}
          accessories={[
            { text: `${version.tracks.filter(Boolean).length} songs` },
            ...(index === currentIndex ? [{ tag: "Current" }] : []),
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Jump to Version"
                onAction={() => {
                  onSelect(index);
                  pop();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default function Command(props: LaunchProps<{ arguments: Arguments.GeneratePlaylist }>) {
  const [searchText, setSearchText] = useState("");
  const [tuneError, setTuneError] = useState<ErrorState | null>(null);
  const [isTuning, setIsTuning] = useState(false);

  // Use usePromise for initial playlist generation (handles React Strict Mode correctly)
  const {
    data: initialPlaylist,
    isLoading: isInitialLoading,
    error: initialError,
    revalidate,
  } = usePromise(
    async () => {
      const prompt = props.arguments.description;
      const initialPlaylist = await generatePlaylistFromPrompt(prompt);
      return initialPlaylist;
    },
    [],
    {
      onError: (err) => {
        showFailureToast(err.message, { title: "Could not generate playlist" });
      },
    },
  );
  const [history, setHistory] = useState<Playlist[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const currentIndex = useMemo(() => {
    if (!currentPlaylist) return -1;
    return history.indexOf(currentPlaylist);
  }, [history, currentPlaylist]);

  useEffect(() => {
    if (initialPlaylist) {
      setHistory([initialPlaylist]);
      setCurrentPlaylist(initialPlaylist);
    }
  }, [initialPlaylist]);

  const isLoading = isInitialLoading || isTuning;

  async function tunePlaylist(prompt: string) {
    if (!prompt.trim()) return;
    if (!currentPlaylist) return;
    if (prompt.trim().toLowerCase() === currentPlaylist.prompt.trim().toLowerCase()) return;

    try {
      setIsTuning(true);
      setTuneError(null);

      const playlist = await generatePlaylistFromPrompt(prompt, prompt, history);
      setHistory((prevHistory) => {
        return [...prevHistory, playlist];
      });
      setCurrentPlaylist(playlist);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setTuneError({
        message: errorMessage,
        failedPrompt: prompt,
      });
      setSearchText(prompt);
      await showFailureToast(errorMessage, { title: "Could not tune playlist" });
    } finally {
      setIsTuning(false);
    }
  }

  function revertToPrevious() {
    if (currentIndex > 0) {
      setCurrentPlaylist(history[currentIndex - 1]);
      showToast({ style: Toast.Style.Success, title: "Reverted to previous version" });
    }
  }

  function redoNext() {
    if (currentIndex < history.length - 1) {
      setCurrentPlaylist(history[currentIndex + 1]);
      setTuneError(null);
      showToast({ style: Toast.Style.Success, title: "Restored next version" });
    }
  }

  function jumpToVersion(index: number) {
    if (index >= 0 && index < history.length) {
      setCurrentPlaylist(history[index]);
      setTuneError(null);
      showToast({ style: Toast.Style.Success, title: `Jumped to version ${index + 1}` });
    }
  }

  async function addPlaylistToSpotify() {
    if (!currentPlaylist) return;
    try {
      await showToast({ style: Toast.Style.Animated, title: "Adding playlist to Spotify" });
      const spotifyPlaylist = await createPlaylist({
        name: currentPlaylist.name,
        description: currentPlaylist.description,
      });
      if (spotifyPlaylist?.id) {
        const trackUris = (currentPlaylist.tracks?.map((track) => track?.uri).filter(Boolean) as string[]) ?? [];
        await addToPlaylist({ playlistId: spotifyPlaylist.id, trackUris: trackUris });
        await showToast({
          style: Toast.Style.Success,
          title: "Added playlist to Spotify",
          message: `"${currentPlaylist.name}" has been added to your Spotify Library`,
          primaryAction: {
            title: `Play "${currentPlaylist.name}"`,
            onAction: async () => {
              await play({ id: spotifyPlaylist.id, type: "playlist", contextUri: spotifyPlaylist.uri });
            },
          },
        });
      }
    } catch (error) {
      await showFailureToast(error, { title: "Could not add playlist to Spotify" });
    }
  }

  async function playPlaylist() {
    if (!currentPlaylist) return;
    if (!currentPlaylist.tracks || currentPlaylist.tracks.length === 0) return;

    try {
      await showToast({ style: Toast.Style.Animated, title: "Starting playlist" });

      // Get all valid track URIs
      const trackUris = currentPlaylist.tracks
        .filter((track: TrackObject): track is NonNullable<typeof track> => track != null && track.uri != null)
        .map((track: TrackObject) => track.uri as string);

      if (trackUris.length === 0) {
        throw new Error("No valid tracks found");
      }

      // Play all tracks at once using uris array (replaces current playback/queue)
      await retry(
        async () => {
          await play({ uris: trackUris });
        },
        // Retry logic to handle cases where Spotify is not open yet.
        { retries: 3, minTimeout: 1000 },
      );

      await showToast({
        style: Toast.Style.Success,
        title: "Playing playlist",
        message: `Now playing "${currentPlaylist.name}"`,
      });
    } catch (error) {
      await showFailureToast(error, { title: "Could not play playlist" });
    }
  }

  async function addSongsToQueue() {
    if (!currentPlaylist) return;
    if (!currentPlaylist.tracks || currentPlaylist.tracks.length === 0) return;

    try {
      await showToast({ style: Toast.Style.Animated, title: "Adding songs to queue" });

      let startedPlayback = false;

      // Using Promise.all could improve performance here, but it would disrupt the order of songs in the queue.
      for (const track of currentPlaylist.tracks) {
        if (!track || !track.uri) continue;

        try {
          await addToQueue({ uri: track.uri });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

          // If no active device/player, play the first track directly to initialize playback
          if (
            !startedPlayback &&
            (errorMessage.includes("no active device") ||
              errorMessage.includes("no device found") ||
              errorMessage.includes("player command failed"))
          ) {
            // Use retry as Spotify may take time to open
            await retry(
              async () => {
                await play({ id: track.id, type: "track" });
              },
              { retries: 3, minTimeout: 1000 },
            );
            startedPlayback = true;
            // Wait for playback to initialize before adding more tracks to queue
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            throw err;
          }
        }
      }

      await showToast({
        style: Toast.Style.Success,
        title: startedPlayback ? "Started playing and added songs to queue" : "Added songs to queue",
        primaryAction: !startedPlayback
          ? {
              title: "Play Next Song in Queue",
              onAction: async () => {
                await skipToNext();
                await play();
              },
            }
          : undefined,
      });
    } catch (error) {
      await showFailureToast(error, { title: "Could not add songs to queue" });
    }
  }

  // Determine placeholder text based on state
  const getPlaceholder = () => {
    if (isLoading) {
      return history.length === 0 ? "Generating playlist..." : "Tuning playlist...";
    }
    return "Search songs or enter a prompt to tune";
  };

  return (
    <View>
      <List
        isLoading={isLoading}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchBarPlaceholder={getPlaceholder()}
      >
        {/* Initial generation error state */}
        {initialError && !isLoading && (
          <>
            <List.Item
              icon={Icon.ExclamationMark}
              title="Error"
              subtitle={initialError.message}
              accessories={[{ tag: { value: "Failed", color: "#FF6B6B" } }]}
            />
            <List.Item
              icon={Icon.RotateClockwise}
              title="Retry"
              subtitle="Press Enter to retry generating the playlist"
              actions={
                <ActionPanel>
                  <Action title="Retry" icon={Icon.RotateClockwise} onAction={() => revalidate()} />
                </ActionPanel>
              }
            />
          </>
        )}

        {/* Tuning error state */}
        {tuneError && !isLoading && (
          <>
            <List.Item
              icon={Icon.ExclamationMark}
              title="Tuning Error"
              subtitle={tuneError.message}
              accessories={[{ tag: { value: "Failed", color: "#FF6B6B" } }]}
            />
            <List.Item
              icon={Icon.RotateClockwise}
              title={searchText ? `Retry: "${searchText}"` : "Retry"}
              subtitle={searchText ? "Press Enter to retry" : "Edit the prompt above and press Enter"}
              actions={
                <ActionPanel>
                  <Action
                    title="Retry"
                    icon={Icon.RotateClockwise}
                    onAction={() => {
                      const promptToUse = searchText.trim() || tuneError.failedPrompt;
                      tunePlaylist(promptToUse);
                    }}
                  />
                </ActionPanel>
              }
            />
            <List.Item
              icon={Icon.ArrowCounterClockwise}
              title="Keep Previous Version"
              subtitle={`Stay with "${currentPlaylist?.name}"`}
              actions={
                <ActionPanel>
                  <Action title="Keep Previous" icon={Icon.ArrowCounterClockwise} onAction={() => setTuneError(null)} />
                </ActionPanel>
              }
            />
          </>
        )}

        {/* Normal playlist UI - only show when no error */}
        {currentPlaylist && (
          <>
            <List.Item
              icon={Icon.Wand}
              title={searchText ? `Tune: "${searchText}"` : "Tune Playlist"}
              subtitle={searchText ? "Press Enter to apply" : "Type a prompt above"}
              actions={
                <ActionPanel>
                  <Action title="Tune with Prompt" icon={Icon.Wand} onAction={() => tunePlaylist(searchText)} />
                </ActionPanel>
              }
            />

            <List.Item
              icon={Icon.Play}
              title="Play Playlist"
              actions={
                <ActionPanel>
                  <Action title="Play Playlist" onAction={playPlaylist} />
                </ActionPanel>
              }
            />

            <List.Item
              icon={Icon.Stars}
              title="Add Playlist to Spotify"
              actions={
                <ActionPanel>
                  <Action title="Add to Spotify" onAction={addPlaylistToSpotify} />
                </ActionPanel>
              }
            />

            <List.Item
              icon={Icon.BulletPoints}
              title="Add Songs to Queue"
              actions={
                <ActionPanel>
                  <Action title="Add Songs" onAction={addSongsToQueue} />
                </ActionPanel>
              }
            />

            {currentIndex > 0 && (
              <List.Item
                icon={Icon.ArrowCounterClockwise}
                title="Revert to Previous Version"
                subtitle={`"${history[currentIndex - 1]?.prompt}"`}
                actions={
                  <ActionPanel>
                    <Action title="Revert" icon={Icon.ArrowCounterClockwise} onAction={revertToPrevious} />
                  </ActionPanel>
                }
              />
            )}

            {currentIndex < history.length - 1 && (
              <List.Item
                icon={Icon.ArrowClockwise}
                title="Redo Next Version"
                subtitle={`"${history[currentIndex + 1]?.prompt}"`}
                actions={
                  <ActionPanel>
                    <Action title="Redo" icon={Icon.ArrowClockwise} onAction={redoNext} />
                  </ActionPanel>
                }
              />
            )}

            {history.length > 1 && (
              <List.Item
                icon={Icon.Clock}
                title="View Tune History"
                subtitle={`${history.length} versions`}
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="View History"
                      icon={Icon.Clock}
                      target={
                        <TuneHistoryList history={history} currentPlaylist={currentPlaylist} onSelect={jumpToVersion} />
                      }
                    />
                  </ActionPanel>
                }
              />
            )}
          </>
        )}

        {/* Track list - show even during tuning error if we have tracks */}
        {currentPlaylist?.tracks && (
          <List.Section title={tuneError ? `Previous: ${currentPlaylist?.name}` : currentPlaylist?.name}>
            {currentPlaylist.tracks.map((track) => {
              if (!track) return null;
              return <TrackListItem key={`${track.id}`} track={track} album={track.album} showGoToAlbum />;
            })}
          </List.Section>
        )}
      </List>
    </View>
  );
}
