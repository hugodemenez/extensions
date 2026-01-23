import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useNavigation } from "@raycast/api";
import { Playlist } from "../generatePlaylist";
import { useState, useEffect } from "react";

type TuneHistoryListProps = {
  history: Playlist[];
  setHistory: (history: Playlist[]) => void;
  currentPlaylist: Playlist | null;
  onSelect: (index: number) => void;
};

export function TuneHistoryList({ history, setHistory, currentPlaylist, onSelect }: TuneHistoryListProps) {
  const { pop } = useNavigation();
  const currentIndex = currentPlaylist ? history.indexOf(currentPlaylist) : -1;
  const [localHistory, setLocalHistory] = useState(history);

  // Sync local state with prop changes
  useEffect(() => {
    setLocalHistory(history);
  }, [history]);

  const handleDelete = (index: number) => {
    const newHistory = localHistory.filter((_, i) => i !== index);
    setLocalHistory(newHistory);
    setHistory(newHistory);
    // Update currentPlaylist selection if needed
    if (currentIndex > index) {
      onSelect(currentIndex - 1);
    } else if (currentIndex === index && newHistory.length > 0) {
      // If we deleted the current item, select the previous one or the first one
      onSelect(Math.max(0, currentIndex - 1));
    } else {
      onSelect(currentIndex);
    }
  };
  return (
    <List navigationTitle="Tune History">
      {localHistory.map((version, index) => (
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
              <Action
                title="Delete Version"
                style={Action.Style.Destructive}
                onAction={() => {
                  handleDelete(index);
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
