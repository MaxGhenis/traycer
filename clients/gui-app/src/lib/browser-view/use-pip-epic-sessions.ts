/**
 * React binding for the epic-wide PiP sessions aggregator.
 *
 * Reachable hosts come from the directory list (not a separate "hosts in this
 * epic" concept). Unreachable hosts are simply absent and join on reconnect.
 * The manager is disposed on unmount so every subscription closes with the
 * epic surface.
 */
import { useEffect, useMemo, useRef } from "react";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import { useRemoteSessionsPollReadiness } from "@/hooks/host/use-remote-sessions-poll-readiness";
import { useDurableStreamTransportFactory } from "@/lib/host/use-durable-stream-transport";
import { dialableHostEndpointFor } from "@/lib/host/transport-key";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import {
  createPipEpicSessionsOpener,
  PipEpicSessionsManager,
} from "./pip-epic-sessions";

export function usePipEpicSessionsFeed(epicId: string): void {
  const directory = useHostDirectoryList();
  const openTransport = useDurableStreamTransportFactory();
  const chats = useEpicChatRecords();
  const directoryHostIds = useMemo(
    () => (directory.data ?? []).map((entry) => entry.hostId),
    [directory.data],
  );
  const hasReadySessionFor = useRemoteSessionsPollReadiness(directoryHostIds);
  const reachableHostIds = useMemo(() => {
    const ids: string[] = [];
    for (const entry of directory.data ?? []) {
      if (
        dialableHostEndpointFor(entry, hasReadySessionFor(entry.hostId)) ===
        null
      ) {
        continue;
      }
      ids.push(entry.hostId);
    }
    return ids;
  }, [directory.data, hasReadySessionFor]);
  const routingChatId = useMemo(() => {
    return (
      chats
        .map((chat) => chat.id)
        .toSorted((left, right) => left.localeCompare(right))[0] ?? null
    );
  }, [chats]);

  const opener = useMemo(
    () => createPipEpicSessionsOpener(openTransport),
    [openTransport],
  );

  const managerRef = useRef<PipEpicSessionsManager | null>(null);

  useEffect(() => {
    const manager = new PipEpicSessionsManager(epicId, opener);
    manager.attach();
    managerRef.current = manager;
    return () => {
      manager.dispose();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [epicId, opener]);

  useEffect(() => {
    managerRef.current?.setChatId(routingChatId);
  }, [routingChatId]);

  useEffect(() => {
    managerRef.current?.setHostIds(reachableHostIds);
  }, [reachableHostIds]);
}

export function PipEpicSessionsFeed(props: { readonly epicId: string }): null {
  usePipEpicSessionsFeed(props.epicId);
  return null;
}
