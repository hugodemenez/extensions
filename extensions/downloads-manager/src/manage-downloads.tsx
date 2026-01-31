import { ActionPanel, Action, List, Grid, Icon, Keyboard } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execFile } from "child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { PathLike } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { useCallback, useState } from "react";
import {
  defaultDownloadsLayout,
  downloadsFolder,
  getDownloads,
  getImageDataUrl,
  getQuickLookPreviewDataUrl,
  isImageFile,
  withAccessToDownloadsFolder,
} from "./utils";

type Download = ReturnType<typeof getDownloads>[number];

function FilePreviewDetail({ download, isSelected }: { download: Download; isSelected: boolean }) {
  const isDarwin = process.platform === "darwin";
  const shouldLoadQuickLook = isSelected && isDarwin;
  const { data: quickLookDataUrl, isLoading: quickLookLoading } = usePromise(
    useCallback(
      () =>
        shouldLoadQuickLook ? getQuickLookPreviewDataUrl(download.path) : Promise.resolve(null),
      [shouldLoadQuickLook, download.path],
    ),
  );
  const imageDataUrl =
    !isDarwin && isImageFile(download.file) ? getImageDataUrl(download.path, download.file) : null;

  const markdown =
    quickLookDataUrl ?? imageDataUrl
      ? `![Preview](${quickLookDataUrl ?? imageDataUrl})`
      : quickLookLoading
        ? `*Loading preview…*`
        : isDarwin
          ? `*Preview unavailable.* Use **Quick Look** (⌘⇧Y) or **Open** to view.`
          : `*Preview is only available on macOS.* Use **Open** to view.`;

  return (
    <List.Item.Detail
      markdown={markdown}
      isLoading={quickLookLoading}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="File" text={download.file} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Last modified"
            text={download.lastModifiedAt.toLocaleString()}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Created"
            text={download.createdAt.toLocaleString()}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function Command() {
  const [downloads, setDownloads] = useState(getDownloads());
  const [downloadsLayout, setDownloadsLayout] = useState<string>(defaultDownloadsLayout);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    () => getDownloads()[0]?.path ?? null,
  );

  function handleTrash(paths: PathLike | PathLike[]) {
    setDownloads((downloads) =>
      downloads.filter((download) => (Array.isArray(paths) ? !paths.includes(download.path) : paths !== download.path)),
    );
  }

  function handleReload() {
    setDownloads(getDownloads());
  }

  const actions = (download: ReturnType<typeof getDownloads>[number]) => (
    <ActionPanel>
      <ActionPanel.Section>
        <Action.Open title="Open File" target={download.path} />
        <Action.ShowInFinder path={download.path} />
        <Action.CopyToClipboard
          title="Copy File"
          content={{ file: download.path }}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        <Action
          title="Reload Downloads"
          icon={Icon.RotateAntiClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={handleReload}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.OpenWith path={download.path} shortcut={Keyboard.Shortcut.Common.OpenWith} />
        <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
        <Action
          title="Toggle Layout"
          icon={downloadsLayout === "list" ? Icon.AppWindowGrid3x3 : Icon.AppWindowList}
          shortcut={{ macOS: { modifiers: ["cmd"], key: "l" }, Windows: { modifiers: ["ctrl"], key: "l" } }}
          onAction={() => setDownloadsLayout(downloadsLayout === "list" ? "grid" : "list")}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.Trash
          title="Delete Download"
          paths={download.path}
          shortcut={Keyboard.Shortcut.Common.Remove}
          onTrash={handleTrash}
        />
        <Action.Trash
          title="Delete All Downloads"
          paths={downloads.map((d) => d.path)}
          shortcut={Keyboard.Shortcut.Common.RemoveAll}
          onTrash={handleTrash}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );

  const emptyViewProps = {
    icon: { fileIcon: downloadsFolder },
    title: "No downloads found",
    description: "Well, first download some files ¯\\_(ツ)_/¯",
  };

  const getItemProps = (download: Download) => ({
    title: download.file,
    quickLook: { path: download.path, name: download.file },
    actions: actions(download),
  });

  if (downloadsLayout === "grid") {
    return (
      <Grid columns={8}>
        {downloads.length === 0 && <Grid.EmptyView {...emptyViewProps} />}
        {downloads.map((download) => (
          <Grid.Item
            key={download.path}
            {...getItemProps(download)}
            content={isImageFile(download.file) ? { source: download.path } : { fileIcon: download.path }}
          />
        ))}
      </Grid>
    );
  }

  return (
    <List isShowingDetail onSelectionChange={setSelectedItemId}>
      {downloads.length === 0 && <List.EmptyView {...emptyViewProps} />}
      {downloads.map((download) => (
        <List.Item
          key={download.path}
          id={download.path}
          {...getItemProps(download)}
          icon={{ fileIcon: download.path }}
          detail={<FilePreviewDetail download={download} isSelected={selectedItemId === download.path} />}
        />
      ))}
    </List>
  );
}

export default withAccessToDownloadsFolder(Command);
