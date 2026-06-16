# Security Specification: Fortress Private Messenger Rules

This document specifies the security requirements, data invariants, and adversarial test cases designed to analyze the integrity of our black-and-white minimalist private messenger.

---

## 1. Data Invariants

1. **User Identity Invariant**: A user document can only be created at `users/{userId}` where `{userId}` is exactly matching the authenticated user's `request.auth.uid`. A user is forbidden from setting or changing their `id` or `uid` once declared, or modifying another user's profile.
2. **Bilateral Connection Invariant**: A connection request can only be sent if the `senderId` strictly matches `request.auth.uid`.
3. **Friend-Only Conversation Invariant**: A message can ONLY be created if the sender and receiver are confirmed accepted friends. To query or look up a message, or write one, the user must be either the sender or receiver.
4. **Authenticity of Fields** (Temporal Integrity): The fields `createdAt` and `updatedAt` must match `request.time`. They are immutable (cannot be rewritten on updates to incorrect values).
5. **Notification Guard**: A notification can only be read or deleted by its recipient (`userId == request.auth.uid`). Users can write a notification when sending a friend request/accepting or message to let the recipient know in real-time.

---

## 2. The "Dirty Dozen" Adversarial Payloads

The following payloads represent attacks designed to break identity, integrity, and state bounds in the messenger. Each test must result in `PERMISSION_DENIED` at the Firestore security rules level.

### Case 1: Profiling Another User (Identity Spoofing)
- **Path**: `users/attacker_uid`
- **Action**: `create`
- **Payload**: User tries to register their profile but sets `id: "admin_uid"`, aiming to hijack admin privileges.
- **Result**: `PERMISSION_DENIED`

### Case 2: Spoofing the Friend Request Originator
- **Path**: `connections/random_id`
- **Action**: `create`
- **Payload**: Attacker tries to send a friend request but sets `senderId: "victim_uid"` to trick another user.
- **Result**: `PERMISSION_DENIED`

### Case 3: Forcing a Friendship State Skip
- **Path**: `connections/victim_sender_id_attacker_receiver_id`
- **Action**: `create`
- **Payload**: Attacker sends a friendship connection pre-verified with `"status": "accepted"` to bypass the victim's accept button.
- **Result**: `PERMISSION_DENIED`

### Case 4: Rogue Message Framing (Non-Friend Exchange)
- **Path**: `messages/rogue_msg`
- **Action**: `create`
- **Payload**: Attacker tries to send a message to a victim with whom they are NOT accepted friends.
- **Result**: `PERMISSION_DENIED`

### Case 5: Message Impersonation
- **Path**: `messages/msg_id_101`
- **Action**: `create`
- **Payload**: Attacker attempts to send a message to their friend but formats the `senderId` as the friend's UID, masquerading as the friend.
- **Result**: `PERMISSION_DENIED`

### Case 6: Hijacking Notifications (Stealing Alerts)
- **Path**: `notifications/notif_id_99`
- **Action**: `get`
- **Payload**: Attacker attempts to read a notification document targeted to a different user ID (`userId: "victim_uid"`).
- **Result**: `PERMISSION_DENIED`

### Case 7: Spamming Giant ID Strings (Denial of Wallet)
- **Path**: `users/A_VERY_LONG_STRING_THAT_EXCEEDS_128_CHARACTERS_TO_WASTE_RESOURCES_AND_CAUSE_DENIAL_OF_WALLET`
- **Action**: `create`
- **Payload**: An ID parameter is formatted with excessive junk content.
- **Result**: `PERMISSION_DENIED`

### Case 8: Shadow Field Injection
- **Path**: `users/user_uid_1`
- **Action**: `update`
- **Payload**: Attacker updates their user document but injects `isAdmin: true` or helper shadow properties not present in the allowed user schema.
- **Result**: `PERMISSION_DENIED`

### Case 9: Altering Immortal Fields
- **Path**: `messages/msg_id_good`
- **Action**: `update`
- **Payload**: Attacker attempts to retrospectively rewrite the immutable `createdAt` timestamp of a stored message.
- **Result**: `PERMISSION_DENIED`

### Case 10: Client-Directed List Query Spoofing
- **Path**: `messages`
- **Action**: `list`
- **Request**: Query checking for messages from `conversationId: "someone_else_convo"`.
- **Result**: `PERMISSION_DENIED` (enforced on rules, query doesn't match authenticated ownership check).

### Case 11: Modifying a Terminated Friendship
- **Path**: `connections/some_conn`
- **Action**: `update`
- **Payload**: Attacker changes a connection that has already been accepted/resolved back to their own custom properties without consent.
- **Result**: `PERMISSION_DENIED`

### Case 12: Arbitrary Notification Erasure
- **Path**: `notifications/any_notif`
- **Action**: `delete`
- **Payload**: Attacker attempts to delete or clear a notification owned by another user.
- **Result**: `PERMISSION_DENIED`
