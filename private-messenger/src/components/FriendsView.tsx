import { useState, useEffect, FormEvent } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { Search, UserPlus, Check, X, UserMinus, MessageSquare, Copy } from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { UserProfile, FriendConnection } from "../types";

interface FriendsViewProps {
  currentUserProfile: UserProfile;
  onNavigateToChat: (friendId: string) => void;
}

export default function FriendsView({ currentUserProfile, onNavigateToChat }: FriendsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  // Connection categories
  const [connections, setConnections] = useState<FriendConnection[]>([]);
  const [userMap, setUserMap] = useState<Record<string, UserProfile>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const myId = auth.currentUser?.uid;

  // Real-time listener for connections
  useEffect(() => {
    if (!myId) return;

    // Fetch incoming and outgoing connections
    const q1 = query(collection(db, "connections"), where("senderId", "==", myId));
    const unsubscribe1 = onSnapshot(
      q1,
      (snapshot) => {
        const list1 = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as FriendConnection));
        setConnections((prev) => {
          const others = prev.filter((c) => c.senderId !== myId);
          return [...others, ...list1];
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "connections");
      }
    );

    const q2 = query(collection(db, "connections"), where("receiverId", "==", myId));
    const unsubscribe2 = onSnapshot(
      q2,
      (snapshot) => {
        const list2 = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as FriendConnection));
        setConnections((prev) => {
          const others = prev.filter((c) => c.receiverId !== myId);
          return [...others, ...list2];
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "connections");
      }
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
    };
  }, [myId]);

  // Fetch full user profiles of anyone we have a connection with to display correctly
  useEffect(() => {
    const fetchConnectedProfiles = async () => {
      const distinctOtherIds = Array.from(
        new Set(
          connections.flatMap((c) => [c.senderId, c.receiverId]).filter((id) => id !== myId)
        )
      ) as string[];

      const missingUserIds = distinctOtherIds.filter((id) => !userMap[id]);
      if (missingUserIds.length === 0) return;

      const newProfiles: Record<string, UserProfile> = {};
      for (const userId of missingUserIds) {
        try {
          const userDoc = await getDocs(
            query(collection(db, "users"), where("id", "==", userId))
          );
          if (!userDoc.empty) {
            const profile = { id: userDoc.docs[0].id, ...userDoc.docs[0].data() } as UserProfile;
            newProfiles[userId] = profile;
          }
        } catch (e) {
          console.error("Failed to fetch profile for", userId, e);
        }
      }

      if (Object.keys(newProfiles).length > 0) {
        setUserMap((prev) => ({ ...prev, ...newProfiles }));
      }
    };

    fetchConnectedProfiles();
  }, [connections, myId, userMap]);

  // Search User by UID
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const queryStr = searchQuery.trim().toLowerCase();
    if (!queryStr) return;

    setSearchLoading(true);
    setSearchError("");
    setSearchResults(null);

    try {
      const q = query(collection(db, "users"), where("uid", "==", queryStr));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setSearchError("No user found with this ID.");
      } else {
        const foundDoc = querySnapshot.docs[0];
        setSearchResults({ id: foundDoc.id, ...foundDoc.data() } as UserProfile);
      }
    } catch (error) {
      setSearchError("Search failed. Try again.");
    } finally {
      setSearchLoading(false);
    }
  };

  // Helper: Generates sorted connection ID
  const getConnectionId = (u1: string, u2: string) => {
    return u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
  };

  // Check relationship status with a user
  const getRelationshipWith = (otherId: string) => {
    const conn = connections.find(
      (c) =>
        (c.senderId === myId && c.receiverId === otherId) ||
        (c.senderId === otherId && c.receiverId === myId)
    );

    if (!conn) return null;
    return conn;
  };

  // Send Friend Request
  const sendFriendRequest = async (target: UserProfile) => {
    if (!myId || !currentUserProfile) return;

    const connId = getConnectionId(myId, target.id);
    const connectionPayload = {
      senderId: myId,
      receiverId: target.id,
      senderName: currentUserProfile.displayName,
      receiverName: target.displayName,
      senderUid: currentUserProfile.uid,
      receiverUid: target.uid,
      status: "requested",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      // Write Connection
      await setDoc(doc(db, "connections", connId), connectionPayload);

      // Write Notification
      const notifId = doc(collection(db, "notifications")).id;
      await setDoc(doc(db, "notifications", notifId), {
        userId: target.id,
        type: "friend_request",
        senderId: myId,
        senderName: currentUserProfile.displayName,
        senderUid: currentUserProfile.uid,
        read: false,
        createdAt: serverTimestamp(),
      });

      // Clear search
      setSearchQuery("");
      setSearchResults(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `connections/${connId}`);
    }
  };

  // Accept Friend Request
  const acceptRequest = async (conn: FriendConnection) => {
    try {
      await updateDoc(doc(db, "connections", conn.id), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });

      // Create Notification for original sender
      const originalSenderId = conn.senderId;
      const notifId = doc(collection(db, "notifications")).id;
      await setDoc(doc(db, "notifications", notifId), {
        userId: originalSenderId,
        type: "friend_accepted",
        senderId: myId,
        senderName: currentUserProfile.displayName,
        senderUid: currentUserProfile.uid,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `connections/${conn.id}`);
    }
  };

  // Decline or Remove Friend Connection
  const removeConnection = async (conn: FriendConnection) => {
    if (!window.confirm("Are you sure you want to remove this connection?")) return;
    try {
      await deleteDoc(doc(db, "connections", conn.id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `connections/${conn.id}`);
    }
  };

  const pendingIncoming = connections.filter(
    (c) => c.receiverId === myId && c.status === "requested"
  );
  const activeFriends = connections.filter((c) => c.status === "accepted");

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="max-w-xl mx-auto space-y-12" id="friends_view_container">
      {/* 1. Add Friend Search Section */}
      <section className="border border-zinc-805 p-6 bg-black" id="add_friend_section">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4 font-mono font-bold">
          Search by UID
        </h2>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            id="friend_search_input"
            type="text"
            className="flex-1 bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-white font-mono text-sm uppercase placeholder-zinc-650 focus:outline-none focus:border-zinc-500"
            placeholder="Type UID (e.g. USER_1234)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            id="friend_search_submit_btn"
            type="submit"
            className="bg-white text-black px-4 py-2.5 text-sm uppercase tracking-wider font-mono hover:bg-zinc-200 transition-colors cursor-pointer"
            disabled={searchLoading}
          >
            {searchLoading ? "..." : "Search"}
          </button>
        </form>

        {searchError && (
          <p className="mt-3 text-xs text-zinc-450 uppercase font-mono" id="search_error_msg">
            {searchError}
          </p>
        )}

        {/* Search Results */}
        {searchResults && (
          <div className="mt-6 border-t border-zinc-900 pt-6" id="search_results_container">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {searchResults.photoURL ? (
                  <img
                    src={searchResults.photoURL}
                    alt=""
                    className="w-10 h-10 object-cover border border-zinc-700 rounded-full grayscale"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center font-mono text-xs uppercase text-white shrink-0">
                    {searchResults.displayName.substring(0, 2)}
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-semibold text-white">{searchResults.displayName}</h3>
                  <p className="text-xs text-zinc-500 font-mono uppercase">{searchResults.uid}</p>
                </div>
              </div>

              {/* Dynamic Connection Options */}
              <div className="flex items-center gap-2">
                {searchResults.id === myId ? (
                  <span className="text-xs text-zinc-500 uppercase font-mono">You</span>
                ) : (() => {
                  const relationship = getRelationshipWith(searchResults.id);
                  if (!relationship) {
                    return (
                      <button
                        id="send_request_btn"
                        onClick={() => sendFriendRequest(searchResults)}
                        className="flex items-center gap-1 bg-white text-black text-xs uppercase px-3 py-1.5 font-mono hover:bg-zinc-200 cursor-pointer"
                      >
                        <UserPlus size={14} /> Send Request
                      </button>
                    );
                  } else if (relationship.status === "requested") {
                    if (relationship.senderId === myId) {
                      return (
                        <span className="text-xs text-zinc-500 uppercase font-mono">
                          Request Sent
                        </span>
                      );
                    } else {
                      return (
                        <button
                          id="search_accept_req_btn"
                          onClick={() => acceptRequest(relationship)}
                          className="flex items-center gap-1 bg-white text-black text-xs uppercase px-3 py-1.5 font-mono hover:bg-zinc-200 cursor-pointer"
                        >
                          <Check size={14} /> Accept Request
                        </button>
                      );
                    }
                  } else if (relationship.status === "accepted") {
                    return (
                      <span className="text-xs text-zinc-500 uppercase font-mono border border-zinc-805 px-2 py-1">
                        Friends
                      </span>
                    );
                  } else if (relationship.status === "declined") {
                    return (
                      <button
                        id="retry_request_btn"
                        onClick={() => sendFriendRequest(searchResults)}
                        className="bg-white text-black text-xs uppercase px-3 py-1.5 font-mono hover:bg-zinc-200 cursor-pointer"
                      >
                        Resend Request
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
            {searchResults.bio && (
              <p className="mt-3 text-xs text-zinc-400 italic bg-zinc-950 p-3 border border-zinc-900 leading-relaxed rounded-sm">
                {searchResults.bio}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 2. Pending Incoming Friend Requests List */}
      {pendingIncoming.length > 0 && (
        <section className="border border-zinc-805 p-6 bg-black" id="incoming_requests_section">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4 font-mono font-bold">
            Incoming Requests ({pendingIncoming.length})
          </h2>
          <div className="space-y-4">
            {pendingIncoming.map((conn) => {
              const senderProfile = userMap[conn.senderId];
              return (
                <div
                  key={conn.id}
                  className="flex items-center justify-between border-b border-zinc-900 pb-3 last:border-b-0 last:pb-0"
                  id={`incoming_req_row_${conn.id}`}
                >
                  <div className="flex items-center gap-3">
                    {senderProfile?.photoURL ? (
                      <img
                        src={senderProfile.photoURL}
                        alt=""
                        className="w-10 h-10 object-cover border border-zinc-700 rounded-full grayscale"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-zinc-855 border border-zinc-700 rounded-full flex items-center justify-center font-mono text-xs text-white shrink-0">
                        {conn.senderName.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-mono uppercase text-zinc-500 block">
                        {conn.senderUid}
                      </span>
                      <span className="text-sm font-medium text-white block -mt-0.5">
                        {conn.senderName}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      id={`accept_btn_${conn.id}`}
                      onClick={() => acceptRequest(conn)}
                      className="bg-white text-black p-1.5 hover:bg-zinc-200 transition-colors cursor-pointer"
                      title="Accept"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      id={`decline_btn_${conn.id}`}
                      onClick={() => removeConnection(conn)}
                      className="bg-zinc-900 border border-zinc-800 text-white p-1.5 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Decline"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Friends List */}
      <section className="border border-zinc-805 p-6 bg-black" id="active_friends_list_section">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4 font-mono font-bold">
          Friends ({activeFriends.length})
        </h2>
        {activeFriends.length === 0 ? (
          <p className="text-xs text-zinc-650 uppercase font-mono italic" id="empty_friends_alert">
            No friends added yet.
          </p>
        ) : (
          <div className="space-y-4">
            {activeFriends.map((conn) => {
              const otherUserId = conn.senderId === myId ? conn.receiverId : conn.senderId;
              const profile = userMap[otherUserId];
              const displayUID = conn.senderId === myId ? conn.receiverUid : conn.senderUid;
              const displayName = conn.senderId === myId ? conn.receiverName : conn.senderName;

              return (
                <div
                  key={conn.id}
                  className="flex items-center justify-between border-b border-zinc-900 pb-4 last:border-b-0 last:pb-0"
                  id={`friend_row_${conn.id}`}
                >
                  <div className="flex items-center gap-3">
                    {profile?.photoURL ? (
                      <img
                        src={profile.photoURL}
                        alt=""
                        className="w-10 h-10 object-cover border border-zinc-700 rounded-full grayscale"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center font-mono text-xs text-zinc-400 uppercase shrink-0">
                        {displayName.substring(0, 2)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-white">{displayName}</span>
                        <button
                          onClick={() => copyToClipboard(displayUID)}
                          className="text-zinc-650 hover:text-white transition-colors cursor-pointer"
                          title="Copy Friend's UID"
                        >
                          <Copy size={12} />
                        </button>
                        {copiedId === displayUID && (
                          <span className="text-[10px] font-mono bg-white text-black px-1.5 uppercase leading-none">
                            Copied
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-mono uppercase text-zinc-500 block">
                        {displayUID}
                      </span>
                      {profile?.bio && (
                        <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-normal italic line-clamp-1">
                          {profile.bio}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      id={`chat_with_${otherUserId}_btn`}
                      onClick={() => onNavigateToChat(otherUserId)}
                      className="bg-white text-black border border-white p-2 hover:bg-zinc-200 transition-colors cursor-pointer"
                      title="Open chat"
                    >
                      <MessageSquare size={16} />
                    </button>
                    <button
                      id={`unfriend_${otherUserId}_btn`}
                      onClick={() => removeConnection(conn)}
                      className="bg-zinc-900 border border-zinc-800 text-zinc-450 hover:text-white p-2 transition-colors cursor-pointer"
                      title="Remove Friend"
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
