import { ActionPanel, Action, List, Grid, Icon, Keyboard } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { PathLike } from "fs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultDownloadsLayout,
  downloadsFolder,
  getDownloads,
  getImageDataUrl,
  getQuickLookPreviewDataUrl,
  isImageFile,
  showPreview,
  withAccessToDownloadsFolder,
} from "./utils";

type Download = {
  file: string;
  path: string;
  size: number;
  isDirectory: boolean;
  itemCount?: number;
  lastModifiedAt: Date;
  createdAt: Date;
  addedAt: Date;
  birthAt: Date;
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return "";
  return filename.slice(lastDot + 1).toUpperCase();
}

function getFileType(download: Download): string {
  if (download.isDirectory) {
    return "Folder";
  }
  const extension = getFileExtension(download.file);
  return extension || "File";
}

function FilePreviewDetail({ download, isSelected }: { download: Download; isSelected: boolean }) {
  const isDarwin = process.platform === "darwin";
  const shouldLoadPreview = isSelected && isDarwin && showPreview;
  const { data: previewDataUrl, isLoading: previewLoading } = usePromise(
    useCallback(
      () => (shouldLoadPreview ? getQuickLookPreviewDataUrl(download.path) : Promise.resolve(null)),
      [shouldLoadPreview, download.path],
    ),
  );
  // Fallback to direct image reading for non-macOS platforms
  const imageDataUrl = !isDarwin && isImageFile(download.file) ? getImageDataUrl(download.path, download.file) : null;

  const markdown =
    (previewDataUrl ?? imageDataUrl)
      ? `![Preview](${previewDataUrl ?? imageDataUrl})`
      : previewLoading
        ? `*Loading preview…*`
        : isDarwin
          ? `*Preview unavailable.* Use **Quick Look** (⌘⇧Y) or **Open** to view.`
          : `*Preview is only available on macOS.* Use **Open** to view.`;

  return (
    <List.Item.Detail
      {...(isDarwin && showPreview && { markdown, isLoading: previewLoading })}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="File" text={download.file} />
          <List.Item.Detail.Metadata.Separator />
          {download.isDirectory ? (
            <>
              <List.Item.Detail.Metadata.Label
                title="Items"
                text={
                  download.itemCount !== undefined
                    ? `${download.itemCount} item${download.itemCount !== 1 ? "s" : ""}`
                    : "—"
                }
              />
              <List.Item.Detail.Metadata.Separator />
            </>
          ) : (
            <>
              <List.Item.Detail.Metadata.Label title="Size" text={formatFileSize(download.size)} />
              <List.Item.Detail.Metadata.Separator />
            </>
          )}
          <List.Item.Detail.Metadata.Label title="Type" text={getFileType(download)} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Last modified" text={download.lastModifiedAt.toLocaleString()} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Created" text={download.createdAt.toLocaleString()} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

const PAGE_SIZE = 50;

function Command() {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);
  const [downloadsLayout, setDownloadsLayout] = useState<string>(defaultDownloadsLayout);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isShowingDetail, setIsShowingDetail] = useState(true);
  const cancelRef = useRef<AbortController | null>(null);

  const loadNextPage = useCallback((offset: number) => {
    setIsLoading(true);
    cancelRef.current?.abort();
    cancelRef.current = new AbortController();

    try {
      const newDownloads = getDownloads(PAGE_SIZE, offset);
      const hasMoreItems = newDownloads.length === PAGE_SIZE;

      if (!cancelRef.current.signal.aborted) {
        if (offset === 0) {
          setDownloads(newDownloads);
          setSelectedItemId(newDownloads[0]?.path ?? null);
        } else {
          setDownloads((prev) => [...prev, ...newDownloads]);
        }
        setHasMore(hasMoreItems);
        setNextOffset(offset + PAGE_SIZE);
      }
    } catch (error) {
      console.error("Error loading downloads:", error);
    } finally {
      if (!cancelRef.current.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  // Load initial page
  useEffect(() => {
    loadNextPage(0);
  }, [loadNextPage]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      loadNextPage(nextOffset);
    }
  }, [isLoading, hasMore, nextOffset, loadNextPage]);

  function handleTrash(paths: PathLike | PathLike[]) {
    setDownloads((downloads) =>
      downloads.filter((download) => (Array.isArray(paths) ? !paths.includes(download.path) : paths !== download.path)),
    );
  }

  const handleReload = useCallback(() => {
    setNextOffset(0);
    loadNextPage(0);
  }, [loadNextPage]);

  const toggleDetailView = useCallback(() => {
    setIsShowingDetail((prev) => !prev);
  }, []);

  const actions = (download: Download) => (
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
        <Action
          title="Toggle Detail View"
          icon={isShowingDetail ? Icon.EyeDisabled : Icon.Eye}
          shortcut={{ macOS: { modifiers: ["cmd", "shift"], key: "l" }, Windows: { modifiers: ["ctrl", "shift"], key: "l" } }}
          onAction={toggleDetailView}
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
      <Grid
        columns={8}
        isLoading={isLoading}
        pagination={{
          onLoadMore: handleLoadMore,
          hasMore,
          pageSize: PAGE_SIZE,
        }}
      >
        {downloads.length === 0 && !isLoading && <Grid.EmptyView {...emptyViewProps} />}
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
    <List
      isShowingDetail={isShowingDetail}
      isLoading={isLoading}
      onSelectionChange={setSelectedItemId}
      pagination={{
        onLoadMore: handleLoadMore,
        hasMore,
        pageSize: PAGE_SIZE,
      }}
    >
      {downloads.length === 0 && !isLoading && <List.EmptyView {...emptyViewProps} />}
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
