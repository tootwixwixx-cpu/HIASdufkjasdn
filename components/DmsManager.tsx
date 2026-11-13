// components/DmsManager.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Mail,
  Send,
  RefreshCw,
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  User,
  ShieldCheck,
} from "lucide-react";

interface ConversationItem {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  last_message: string;
  last_timestamp: string;
  unread_count: number;
}

interface DevMessage {
  id: string;
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  sender_type: "user" | "dev";
  message: string;
  read: boolean;
  created_at: string;
}

export default function DmsManager() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DevMessage[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  // Fetch list of conversations
  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/chatroom/dms");
      if (res.ok) {
        const data = await res.json();
        if (data.conversations) {
          setConversations(data.conversations);
          // If no conversation currently selected and we have conversations, select the first one
          if (!selectedUserId && data.conversations.length > 0) {
            setSelectedUserId(data.conversations[0].user_id);
          }
        }
      }
    } catch (err) {
      console.error("Error loading conversations:", err);
    } finally {
      setLoadingList(false);
    }
  };

  // Fetch thread messages for selected user
  const fetchThread = async (userId: string) => {
    try {
      const res = await fetch(`/api/chatroom/dms?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
          setTimeout(() => {
            if (threadEndRef.current) {
              threadEndRef.current.scrollIntoView({ behavior: "smooth" });
            }
          }, 60);
        }
      }
      // Mark as read
      await fetch("/api/chatroom/dms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      // Update local unread counter
      setConversations((prev) =>
        prev.map((c) => (c.user_id === userId ? { ...c, unread_count: 0 } : c))
      );
    } catch (err) {
      console.error("Error loading thread:", err);
    } finally {
      setLoadingThread(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      setLoadingThread(true);
      fetchThread(selectedUserId);
      const threadInterval = setInterval(() => {
        fetchThread(selectedUserId);
      }, 3500);
      return () => clearInterval(threadInterval);
    }
  }, [selectedUserId]);

  // Send reply
  const handleSendReply = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyInput.trim();
    if (!text || !selectedUserId || sendingReply) return;

    setSendingReply(true);
    const activeConv = conversations.find((c) => c.user_id === selectedUserId);

    try {
      const res = await fetch("/api/chatroom/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          username: "Admin / Dev",
          displayName: "Admin / Dev",
          senderType: "dev",
          message: text,
        }),
      });

      const data = await res.json();
      if (data.success && data.message) {
        setReplyInput("");
        setMessages((prev) => [...prev, data.message]);
        showNotice("Reply delivered to player's in-game hub!");
        setTimeout(() => {
          if (threadEndRef.current) {
            threadEndRef.current.scrollIntoView({ behavior: "smooth" });
          }
        }, 50);
      } else {
        showNotice(data.error || "Failed to send reply.");
      }
    } catch (err) {
      console.error(err);
      showNotice("Error sending reply.");
    } finally {
      setSendingReply(false);
    }
  };

  const selectedConv = conversations.find((c) => c.user_id === selectedUserId);

  const filteredConversations = conversations.filter((c) => {
    const q = searchTerm.toLowerCase();
    return (
      c.username.toLowerCase().includes(q) ||
      c.user_id.includes(q) ||
      c.last_message.toLowerCase().includes(q)
    );
  });

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-success-text text-caption flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-success-text shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-surface-raised border border-line rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent-text">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-body-sm font-bold text-fg flex items-center gap-2">
              Direct Messages / "Contact Your Dev"
              <span className="px-2 py-0.5 rounded-full text-micro font-data bg-accent/20 text-accent-text border border-accent/30">
                {conversations.length} Active Conversations
              </span>
            </h2>
            <p className="text-caption text-fg-muted mt-0.5">
              1-on-1 private tickets and direct support chats initiated by players directly through their in-game AtomWare script hub.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            fetchConversations();
            if (selectedUserId) fetchThread(selectedUserId);
          }}
          disabled={loadingList}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-active text-fg hover:text-fg text-caption font-semibold border border-line-strong transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Two-Pane DMs Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[640px]">
        {/* Left Pane: Conversations List */}
        <div className="flex flex-col bg-surface-raised border border-line rounded-lg overflow-hidden">
          <div className="p-3 bg-surface border-b border-line">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by player or user ID..."
                className="w-full bg-surface-hover border border-line-strong rounded-lg pl-9 pr-3 py-1.5 text-caption text-fg placeholder:text-fg-subtle outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-line-subtle">
            {filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-fg-subtle text-caption">
                <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No direct messages yet.</p>
                <p className="text-micro text-fg-disabled mt-0.5">Players can click "Contact Your Dev" in-game to start a chat.</p>
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isSelected = c.user_id === selectedUserId;
                const uid = c.user_id && c.user_id !== "0" ? c.user_id : null;

                return (
                  <button
                    key={c.user_id}
                    type="button"
                    onClick={() => setSelectedUserId(c.user_id)}
                    className={`w-full text-left p-3 flex items-start gap-3 transition-colors ${
                      isSelected
                        ? "bg-accent/15 border-l-2 border-accent/60"
                        : "hover:bg-surface-hover"
                    }`}
                  >
                    <img
                      src={
                        uid
                          ? `/api/roblox/avatar?userId=${uid}`
                          : `/api/roblox/avatar?username=${encodeURIComponent(c.username)}`
                      }
                      alt={c.username}
                      className="w-10 h-10 rounded-full bg-surface-hover border border-line-strong object-cover shrink-0"
                      onError={(e: any) => {
                        e.target.src = `/api/roblox/avatar?username=${encodeURIComponent(c.username)}`;
                      }}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-caption font-bold truncate ${isSelected ? "text-accent-text" : "text-fg"}`}>
                          {c.username}
                        </span>
                        <span className="text-micro text-fg-subtle font-data shrink-0 ml-1">
                          {formatTime(c.last_timestamp)}
                        </span>
                      </div>

                      <p className="text-caption text-fg-muted truncate mt-0.5">
                        {c.last_message}
                      </p>

                      <div className="flex items-center gap-1.5 mt-1 text-micro text-fg-subtle">
                        <span>ID: {c.user_id}</span>
                        {c.unread_count > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full bg-danger text-fg font-bold text-micro">
                            {c.unread_count} new
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Active Conversation Thread (2/3 width) */}
        <div className="lg:col-span-2 flex flex-col bg-surface-raised border border-line rounded-lg overflow-hidden">
          {selectedConv ? (
            <>
              {/* Thread Header */}
              <div className="px-4 py-3 bg-surface border-b border-line flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={
                      selectedConv.user_id && selectedConv.user_id !== "0"
                        ? `/api/roblox/avatar?userId=${selectedConv.user_id}`
                        : `/api/roblox/avatar?username=${encodeURIComponent(selectedConv.username)}`
                    }
                    alt={selectedConv.username}
                    className="w-8 h-8 rounded-full border border-line-strong object-cover"
                    onError={(e: any) => {
                      e.target.src = `/api/roblox/avatar?username=${encodeURIComponent(selectedConv.username)}`;
                    }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-bold text-fg">{selectedConv.username}</span>
                      {selectedConv.user_id && selectedConv.user_id !== "0" && (
                        <a
                          href={`https://www.roblox.com/users/${selectedConv.user_id}/profile`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-micro text-accent-text hover:text-accent-text flex items-center gap-1"
                        >
                          <span>Roblox Profile</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <span className="text-micro text-fg-subtle font-data">User ID: {selectedConv.user_id}</span>
                  </div>
                </div>

                <span className="text-micro text-success-text flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  Direct Script Channel
                </span>
              </div>

              {/* Thread Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 custom-scrollbar">
                {loadingThread && messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-caption text-fg-subtle">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading conversation...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-16 text-fg-subtle text-caption">
                    <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>No messages yet in this ticket.</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isDev = m.sender_type === "dev";

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isDev ? "items-end" : "items-start"}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1 text-micro text-fg-subtle">
                          <span className="font-semibold text-fg">
                            {isDev ? "👑 Admin / Dev" : m.username}
                          </span>
                          <span>•</span>
                          <span>{formatTime(m.created_at)}</span>
                        </div>

                        <div
                          className={`max-w-md px-3.5 py-2.5 rounded-lg text-caption break-words leading-relaxed ${
                            isDev
                              ? "bg-accent text-accent-fg rounded-br-none"
                              : "bg-surface-hover text-fg border border-line-strong rounded-bl-none"
                          }`}
                        >
                          {m.message}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Reply Input Bar */}
              <form
                onSubmit={handleSendReply}
                className="p-3 bg-surface border-t border-line flex items-center gap-2"
              >
                <input
                  type="text"
                  value={replyInput}
                  onChange={(e) => setReplyInput(e.target.value)}
                  placeholder={`Reply to @${selectedConv.username}...`}
                  className="flex-1 bg-surface-hover border border-line-strong rounded-lg px-3.5 py-2 text-caption text-fg placeholder:text-fg-subtle outline-none focus:border-accent"
                />

                <button
                  type="submit"
                  disabled={sendingReply || !replyInput.trim()}
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-fg text-caption font-semibold flex items-center gap-1.5 transition-all shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingReply ? "Sending..." : "Send Reply"}</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-4 text-fg-subtle">
              <User className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-body-sm font-semibold text-fg-muted">Select a Conversation</p>
              <p className="text-caption text-fg-subtle mt-1 max-w-sm">
                Choose a player from the list on the left to view and respond to their direct messages.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
