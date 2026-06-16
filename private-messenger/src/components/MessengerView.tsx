import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, orderBy, getDocs } from "firebase/firestore";
import { Search, MessageSquare, ArrowRight, CornerDownRight, Copy } from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { ChatMessage, UserProfile, FriendConnection } from "../types";
import ConversationView from "./ConversationView";

interface MessengerViewProps {
  currentUserProfile: UserProfile;
  initialTargetFriendId?: string; // Deep links from alert notifications
}

export default function MessengerView({ currentUserProfile, initialTargetFriendId }: MessengerViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [friends, setFriends] = useState<FriendConnection[]>([]);
  const [userRegistry, setUserRegistry] = useState<Record<string, UserProfile>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFriendId, setActiveFriendId] = useState<string | null>(initialTargetFriendId || null);

  const myId = auth.currentUser?.uid;

  // 1. Subscribe to mutual friends connections
  useEffect(() => {
    if (!myId) return;

    // We fetch connections where we are sender or receiver and status is accepted
    const q1 = query(
      collection(db, "connections"),
      where("senderId", "==", myId),
      where("status", "==", "accepted")
    );
    const unsubscribe1 = onSnapshot(
      q1,
      (snapshot) => {
        const list1 = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as FriendConnection));
        setFriends((prev) => {
          const others = prev.filter((f) => f.senderId !== myId);
          return [...others, ...list1];
        });
      },
      (error) => handleFirestoreError(error, OperationType.GET, "connections_sender")
    );

    const q2 = query(
      collection(db, "connections"),
      where("receiverId", "==", myId),
      where("status", "==", "accepted")
    );
    const unsubscribe2 = onSnapshot(
      q2,
      (snapshot) => {
        const list2 = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as FriendConnection));
        setFriends((prev) => {
          const others = prev.filter((f) => f.receiverId !== myId);
          return [...others, ...list2];
        });
      },
      (error) => handleFirestoreError(error, OperationType.GET, "connections_receiver")
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
    };
  }, [myId]);

  // Handle deep linking updates when initialTargetFriendId changes
  useEffect(() => {
    if (initialTargetFriendId) {
      setActiveFriendId(initialTargetFriendId);
    }
  }, [initialTargetFriendId]);

  // 2. Fetch messages to construct conversation inbox list
  // To get a list of active chats, we listen to all messages involving either senderId or receiverId is current user.
  useEffect(() => {
    if (!myId) return;

    const qSender = query(collection(db, "messages"), where("senderId", "==", myId));
    const unsubscribeSend = onSnapshot(qSender, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.senderId !== myId);
        return [...filtered, ...list];
      });
    });

    const qRecv = query(collection(db, "messages"), where("receiverId", "==", myId));
    const unsubscribeRecv = onSnapshot(qRecv, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.receiverId !== myId);
        return [...filtered, ...list];
      });
    });

    return () => {
      unsubscribeSend();
      unsubscribeRecv();
    };
  }, [myId]);

  // 3. Fetch full profiles for userRegistry for display name and avatars
  useEffect(() => {
    const fetchRegistry = async () => {
      const allActiveUserIds = Array.from(
        new Set([
          ...friends.flatMap((f) => [f.senderId, f.receiverId]),
          ...messages.flatMap((m) => [m.senderId, m.receiverId]),
        ])
      ).filter((id) => id !== myId);

      const missingIds = allActiveUserIds.filter((id) => !userRegistry[id]);
      if (missingIds.length === 0) return;

      const fetched: Record<string, UserProfile> = {};
      for (const id of missingIds) {
        try {
          const uQuery = query(collection(db, "users"), where("id", "==", id));
          const snap = await getDocs(uQuery);
          if (!snap.empty) {
            fetched[id] = { id: snap.docs[0].id, ...snap.docs[0].data() } as UserProfile;
          }
        } catch (e) {
          console.error("Registry fetch failure", id, e);
        }
      }

      if (Object.keys(fetched).length > 0) {
        setUserRegistry((prev) => ({ ...prev, ...fetched }));
      }
    };

    fetchRegistry();
  }, [friends, messages, myId, userRegistry]);

  // Determine active chats (friends with at least 1 message)
  const chatHistoryUserIds = Array.from(
    new Set(
      messages
        .flatMap((m) => [m.senderId, m.receiverId])
        .filter((id) => id !== myId)
    )
  );

  // Build the list of active inbox chat items
  const activeChatItems = chatHistoryUserIds
    .map((friendId) => {
      const profile = userRegistry[friendId];
      const friendMessages = messages.filter(
        (m) =>
          (m.senderId === myId && m.receiverId === friendId) ||
          (m.senderId === friendId && m.receiverId === myId)
      );

      // Get latest message
      const latestMessage = friendMessages.sort(
        (a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0)
      )[0];

      const unreadCount = friendMessages.filter((m) => m.receiverId === myId && !m.read).length;

      return {
        friendId,
        profile,
        latestMessage,
        unreadCount,
      };
    })
    // Sort conversations by latest message timestamp
    .sort((a, b) => {
      const timeA = a.latestMessage?.createdAt?.toDate?.() || 0;
      const timeB = b.latestMessage?.createdAt?.toDate?.() || 0;
      return timeB - timeA;
    });

  // Messenger search filters
  // 1. Existing inbox items matching search
  const filteredInbox = activeChatItems.filter((item) => {
    if (!searchQuery) return true;
    const name = item.profile?.displayName?.toLowerCase() || "";
    const uid = item.profile?.uid?.toLowerCase() || "";
    const queryStr = searchQuery.toLowerCase();
    return name.includes(queryStr) || uid.includes(queryStr);
  });

  // 2. Discoverable accepted friends who have NO messages yet (to satisfy "Search contacts")
  const nonInboxFriends = friends
    .map((conn) => {
      const fId = conn.senderId === myId ? conn.receiverId : conn.senderId;
      const fUid = conn.senderId === myId ? conn.receiverUid : conn.senderUid;
      const fName = conn.senderId === myId ? conn.receiverName : conn.senderName;
      return { id: fId, uid: fUid, displayName: fName };
    })
    .filter((f) => !chatHistoryUserIds.includes(f.id))
    .filter((f) => {
      if (!searchQuery) return false; // Only show non-inbox matches when actively searching
      const name = f.displayName.toLowerCase();
      const uid = f.uid.toLowerCase();
      const queryStr = searchQuery.toLowerCase();
      return name.includes(queryStr) || uid.includes(queryStr);
    });

  const activeFriendProfile = activeFriendId ? userRegistry[activeFriendId] : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[72vh] overflow-hidden" id="messenger_primary_grid_wrapper">
      {/* LEFT INBOX: Shown if on desktop OR if on mobile with no active discussion */}
      <div
        className={`md:col-span-4 flex flex-col h-full bg-black border border-zinc-800 p-4 space-y-4 ${
          activeFriendId ? "hidden md:flex" : "flex"
        }`}
        id="messenger_inbox_panel"
      >
        {/* Search Bar */}
        <div className="relative" id="inbox_search_box">
          <input
            id="inbox_search_input"
            type="text"
            className="w-full bg-zinc-900 border border-zinc-800 pl-10 pr-4 py-2.5 text-white font-mono uppercase text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-500"
            placeholder="Search username or UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search size={14} className="absolute left-3 top-3 text-zinc-500" />
        </div>

        {/* Conversation Logs list */}
        <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin" id="inbox_scrolling_logs">
          {searchQuery && (nonInboxFriends.length > 0 || filteredInbox.length > 0) && (
            <div className="text-[10px] font-mono uppercase text-zinc-550 mb-1 tracking-wider px-1">
              Search Results
            </div>
          )}

          {/* Render new non-chat friends found during searches */}
          {nonInboxFriends.map((friend) => (
            <button
              key={friend.id}
              onClick={() => {
                const profile = userRegistry[friend.id] || {
                  id: friend.id,
                  uid: friend.uid,
                  displayName: friend.displayName,
                  bio: "",
                  photoURL: "",
                  coverURL: "",
                  createdAt: null,
                };
                setUserRegistry((prev) => ({ ...prev, [friend.id]: profile }));
                setActiveFriendId(friend.id);
                setSearchQuery("");
              }}
              className="w-full p-3 border border-dashed border-zinc-800 bg-zinc-900/20 hover:bg-zinc-950 hover:border-zinc-700 text-left transition-all flex items-center justify-between group rounded-sm cursor-pointer"
              id={`search_contact_${friend.id}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center font-mono text-xs text-zinc-400 capitalize shrink-0">
                  {friend.displayName.substring(0, 2)}
                </div>
                <div>
                  <span className="text-xs font-mono uppercase text-zinc-500 block">
                    {friend.uid}
                  </span>
                  <span className="text-sm font-semibold text-white block -mt-0.5">
                    {friend.displayName}
                  </span>
                </div>
              </div>
              <CornerDownRight size={14} className="text-zinc-500 group-hover:text-white transition-colors" />
            </button>
          ))}

          {/* Render active inbox conversations */}
          {filteredInbox.length === 0 && nonInboxFriends.length === 0 ? (
            <div className="py-16 text-center" id="inbox_empty_indicator">
              <MessageSquare size={20} className="mx-auto text-zinc-800 mb-2" />
              <p className="text-[10px] font-mono text-zinc-650 uppercase italic">
                {searchQuery ? "No matches found." : "No chat history exists."}
              </p>
            </div>
          ) : (
            filteredInbox.map((item) => {
              const active = activeFriendId === item.friendId;
              const hasUnread = item.unreadCount > 0;

              return (
                <button
                  key={item.friendId}
                  onClick={() => {
                    setActiveFriendId(item.friendId);
                    setSearchQuery("");
                  }}
                  className={`w-full p-3 border text-left transition-all flex items-center justify-between relative rounded-sm cursor-pointer ${
                    active
                      ? "bg-zinc-900 text-white border-zinc-850"
                      : "bg-black text-white border-zinc-950 hover:border-zinc-800 hover:bg-zinc-900/40"
                  }`}
                  id={`inbox_item_${item.friendId}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    {/* Avatar preview */}
                    {item.profile?.photoURL ? (
                      <img
                        src={item.profile.photoURL}
                        alt=""
                        className="w-10 h-10 object-cover border border-zinc-700 rounded-full grayscale shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-10 h-10 border border-zinc-700 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center font-mono text-xs uppercase shrink-0">
                        {(item.profile?.displayName || "UN").substring(0, 2)}
                      </div>
                    )}

                    <div className="overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold truncate text-white">
                          {item.profile?.displayName || "Friend"}
                        </span>
                        {hasUnread && (
                          <span className="w-1.5 h-1.5 bg-white rounded-full block border border-black" />
                        )}
                      </div>
                      <span className="text-[10px] font-mono uppercase block -mt-0.5 text-zinc-500">
                        {item.profile?.uid || "UID"}
                      </span>
                      {item.latestMessage && (
                        <p className={`text-[11px] truncate mt-1 ${active ? "text-zinc-300" : "text-zinc-400"}`}>
                          {item.latestMessage.type === "image"
                            ? "[Photo]"
                            : item.latestMessage.type === "video"
                            ? "[Video]"
                            : item.latestMessage.text}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Badges/Alert indicator */}
                  <div className="flex flex-col items-end shrink-0 pl-1.5 font-mono text-[9px]">
                    <span className="text-zinc-500">
                      {item.latestMessage?.createdAt?.toDate
                        ? item.latestMessage.createdAt.toDate().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    {hasUnread && (
                      <span className="mt-1 text-[9px] font-bold px-1.5 py-0.2 font-mono uppercase bg-white text-black">
                        {item.unreadCount} NEW
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT DISCUSSION SCREEN */}
      <div
        className={`md:col-span-8 h-full ${
          activeFriendId ? "flex flex-col" : "hidden md:flex items-center justify-center border border-zinc-800 bg-black"
        }`}
        id="messenger_discussion_panel"
      >
        {activeFriendId && activeFriendProfile ? (
          <ConversationView
            friendId={activeFriendId}
            friendProfile={activeFriendProfile}
            currentUserProfile={currentUserProfile}
            onBack={() => setActiveFriendId(null)}
          />
        ) : (
          <div className="text-center py-24 px-6 uppercase" id="chat_unopened_slate">
            <MessageSquare size={24} className="mx-auto text-zinc-800 mb-2" />
            <p className="text-[10px] font-mono tracking-widest text-zinc-600 italic">
              Select private connection to engage channel
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
