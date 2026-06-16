export interface UserProfile {
  id: string; // Firebase Authentication UID
  uid: string; // Simple unique display ID (e.g. "alex42")
  displayName: string;
  bio: string;
  photoURL: string;
  coverURL: string;
  createdAt: any;
}

export interface FriendConnection {
  id: string; // senderId_receiverId (Bilateral pair)
  senderId: string;
  receiverId: string;
  senderName: string;
  receiverName: string;
  senderUid: string;
  receiverUid: string;
  status: "requested" | "accepted" | "declined";
  createdAt: any;
  updatedAt: any;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  text: string;
  type: "text" | "image" | "video" | "emoji";
  mediaUrl: string;
  read: boolean;
  createdAt: any;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: "friend_request" | "friend_accepted" | "message";
  senderId: string;
  senderName: string;
  senderUid: string;
  read: boolean;
  createdAt: any;
}

export type ViewType = "chats" | "friends" | "notifications" | "profile" | "settings";
