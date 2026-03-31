import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MessageCircle, Users, UserPlus, Settings, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Conversation, Profile } from '@/types/db';
import CreateGroupDialog from './CreateGroupDialog';
import { useRealtimeSocket } from '@/hooks/use-realtime-socket';

type RealtimeEvent = {
  type?: string;
};

interface ChatSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onToggleFriendRequests: () => void;
  showFriendRequests: boolean;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  activeConversationId,
  onSelectConversation,
  onToggleFriendRequests,
  showFriendRequests,
}) => {
  const { profile, user } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<(Conversation & { otherUser?: Profile | null })[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const { socket } = useRealtimeSocket();

  useEffect(() => {
    if (!user) return;
    void loadConversations();
    void loadPendingCount();
  }, [user]);

  useEffect(() => {
    if (!socket || !user) return;

    const handleRealtimeEvent = (event: RealtimeEvent) => {
      const eventType = event.type || '';
      if (eventType === 'conversations.changed' || eventType === 'message.created') {
        void loadConversations();
      }
      if (eventType === 'friendships.changed') {
        void loadPendingCount();
      }
    };

    socket.on('realtime:event', handleRealtimeEvent);

    return () => {
      socket.off('realtime:event', handleRealtimeEvent);
    };
  }, [socket, user]);

  const loadConversations = async () => {
    if (!user) return;
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    setConversations(payload.conversations || []);
  };

  const loadPendingCount = async () => {
    if (!user) return;
    const response = await fetch('/api/friendships?type=pendingCount', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    setPendingCount(payload.count || 0);
  };

  const getConversationName = (conv: Conversation & { otherUser?: Profile | null }) => {
    if (conv.type === 'group') return conv.name || 'Group';
    return conv.otherUser?.display_name || 'Unknown';
  };

  const getConversationInitial = (conv: Conversation & { otherUser?: Profile | null }) => {
    const name = getConversationName(conv);
    return name.charAt(0).toUpperCase();
  };

  const handleGroupCreated = async (conversationId?: string) => {
    await loadConversations();
    if (conversationId) {
      onSelectConversation(conversationId);
    }
  };

  return (
    <>
      <div className="w-80 bg-card border-r border-border flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bubble-gradient flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="font-display font-bold text-foreground text-lg">Bubble</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateGroup(true)}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Create group"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleFriendRequests}
              className={`p-2 rounded-lg transition-colors relative ${showFriendRequests ? 'bg-primary/20 text-primary' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'}`}
              title="Friend requests"
            >
              <UserPlus className="w-4 h-4" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => router.push('/profile')}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Profile"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {conversations.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add friends to start chatting</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full p-3 flex items-center gap-3 transition-colors ${
                  activeConversationId === conv.id
                    ? 'bg-secondary'
                    : 'hover:bg-secondary/50'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm ${
                  conv.type === 'group' ? 'bg-accent text-accent-foreground' : 'bubble-gradient text-primary-foreground'
                }`}>
                  {conv.type === 'group' ? <Users className="w-4 h-4" /> : getConversationInitial(conv)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{getConversationName(conv)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {conv.type === 'group' ? 'Group chat' : `@${conv.otherUser?.username || ''}`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* User info */}
        <div className="p-3 border-t border-border">
          <button
            onClick={() => router.push('/profile')}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <div className="w-8 h-8 rounded-full bubble-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="text-left min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{profile?.display_name}</p>
              <p className="text-xs text-muted-foreground truncate">@{profile?.username}</p>
            </div>
          </button>
        </div>
      </div>

      <CreateGroupDialog open={showCreateGroup} onOpenChange={setShowCreateGroup} onCreated={handleGroupCreated} />
    </>
  );
};

export default ChatSidebar;
