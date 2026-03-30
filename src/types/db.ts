export interface Profile {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  status: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deletion_recover_until?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  type: "dm" | "group";
  name: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: string;
  created_at: string;
  updated_at: string;
}
