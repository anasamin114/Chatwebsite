import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import { Bell, Check, Trash2, MailOpen, UserCheck, MessageSquare } from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { AppNotification } from "../types";

interface NotificationsViewProps {
  onNavigateToView: (view: "chats" | "friends" | "notifications" | "profile" | "settings", targetUserId?: string) => void;
}

export default function NotificationsView({ onNavigateToView }: NotificationsViewProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const myId = auth.currentUser?.uid;

  // Real-time listener for user's notifications
  useEffect(() => {
    if (!myId) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", myId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() } as AppNotification)
        );
        setNotifications(list);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "notifications");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [myId]);

  // Mark single as read
  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, "notifications", id), {
        read: true,
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `notifications/${id}`);
    }
  };

  // Delete single notification
  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `notifications/${id}`);
    }
  };

  // Mark all as read using batch writes
  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter((n) => !n.read);
    if (unreadNotifications.length === 0) return;

    try {
      const batch = writeBatch(db);
      unreadNotifications.forEach((n) => {
        batch.update(doc(db, "notifications", n.id), { read: true });
      });
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, "notifications_batch_read");
    }
  };

  // Clear all notifications
  const clearAllNotifications = async () => {
    if (notifications.length === 0) return;
    if (!window.confirm("Are you sure you want to clear all notifications?")) return;

    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        batch.delete(doc(db, "notifications", n.id));
      });
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, "notifications_batch_delete");
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-xl mx-auto space-y-6" id="notifications_view_container">
      {/* Action Header */}
      <div className="flex items-center justify-between border-b border-zinc-905 pb-4">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-white" />
          <h1 className="text-md uppercase tracking-wider font-mono font-bold text-white">
            Notifications {unreadCount > 0 && `(${unreadCount})`}
          </h1>
        </div>
        {notifications.length > 0 && (
          <div className="flex gap-4">
            {unreadCount > 0 && (
              <button
                id="mark_all_read_btn"
                onClick={markAllAsRead}
                className="text-[11px] uppercase tracking-wider font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                Mark all read
              </button>
            )}
            <button
              id="clear_all_notif_btn"
              onClick={clearAllNotifications}
              className="text-[11px] uppercase tracking-wider font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center" id="notif_loading_state">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-600">Loading...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-24 text-center border border-dashed border-zinc-900" id="notif_empty_state">
          <Bell size={24} className="mx-auto text-zinc-800 mb-2" />
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-650 italic">
            Zero logs. Everything is clear.
          </p>
        </div>
      ) : (
        <div className="space-y-3" id="notifications_list">
          {notifications.map((notif) => {
            const isUnread = !notif.read;

            return (
              <div
                key={notif.id}
                className={`border p-4 flex items-start justify-between transition-all rounded-sm ${
                  isUnread
                    ? "bg-zinc-900/55 border-zinc-700"
                    : "bg-black border-zinc-900 hover:border-zinc-800 hover:bg-zinc-950/30"
                }`}
                id={`notification_item_${notif.id}`}
              >
                <div className="flex gap-3">
                  {/* Icon Indicator */}
                  <div className="mt-0.5">
                    {notif.type === "friend_request" && (
                      <Bell size={16} className="text-zinc-300" />
                    )}
                    {notif.type === "friend_accepted" && (
                      <UserCheck size={16} className="text-zinc-300" />
                    )}
                    {notif.type === "message" && (
                      <MessageSquare size={16} className="text-zinc-300" />
                    )}
                  </div>

                  <div>
                    {/* Notification Alert Message */}
                    <p className="text-sm text-zinc-300 leading-normal">
                      {notif.type === "friend_request" && (
                        <span>
                          <strong className="text-white font-semibold">
                            {notif.senderName}
                          </strong>{" "}
                          (<span className="font-mono text-xs uppercase">{notif.senderUid}</span>)
                          sent you a friend request.
                        </span>
                      )}
                      {notif.type === "friend_accepted" && (
                        <span>
                          <strong className="text-white font-semibold">
                            {notif.senderName}
                          </strong>{" "}
                          (<span className="font-mono text-xs uppercase">{notif.senderUid}</span>)
                          accepted your friend request.
                        </span>
                      )}
                      {notif.type === "message" && (
                        <span>
                          New private message from{" "}
                          <strong className="text-white font-semibold">
                            {notif.senderName}
                          </strong>{" "}
                          (<span className="font-mono text-xs uppercase">{notif.senderUid}</span>).
                        </span>
                      )}
                    </p>

                    {/* Meta Time & Direct Navigation Actions */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-zinc-500 uppercase">
                      <span>
                        {notif.createdAt?.toDate
                          ? notif.createdAt.toDate().toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Just now"}
                      </span>
                      <span>•</span>
                      {notif.type === "friend_request" && (
                        <button
                          onClick={() => {
                            if (isUnread) markAsRead(notif.id);
                            onNavigateToView("friends");
                          }}
                          className="hover:text-white underline cursor-pointer"
                        >
                          View Request
                        </button>
                      )}
                      {notif.type === "friend_accepted" && (
                        <button
                          onClick={() => {
                            if (isUnread) markAsRead(notif.id);
                            onNavigateToView("friends");
                          }}
                          className="hover:text-white underline cursor-pointer"
                        >
                          View Friends
                        </button>
                      )}
                      {notif.type === "message" && (
                        <button
                          onClick={() => {
                            if (isUnread) markAsRead(notif.id);
                            onNavigateToView("chats", notif.senderId);
                          }}
                          className="hover:text-white underline cursor-pointer"
                        >
                          Open Chat
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Operations */}
                <div className="flex items-center gap-1 ml-4 pt-1">
                  {isUnread && (
                    <button
                      id={`mark_read_btn_${notif.id}`}
                      onClick={() => markAsRead(notif.id)}
                      className="text-zinc-500 hover:text-white p-1 transition-colors cursor-pointer"
                      title="Mark as Read"
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    id={`delete_notif_btn_${notif.id}`}
                    onClick={() => deleteNotification(notif.id)}
                    className="text-zinc-500 hover:text-white p-1 transition-colors cursor-pointer"
                    title="Delete Notification"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
