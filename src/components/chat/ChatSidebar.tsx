import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MessageCircle, Users, UserPlus, Settings, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Tables } from '@/integrations/supabase/types';
import CreateGroupDialog from './CreateGroupDialog';

type Conversation = Tables<'conversations'>;

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
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<(Conversation & { otherUser?: Tables<'profiles'> })[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => {
    if (!profile) return;
    loadConversations();
    loadPendingCount();
  }, [profile]);

  const loadConversations = async () => {
    if (!profile) return;

    const { data: memberData } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', profile.user_id);

    if (!memberData?.length) return;

    const convIds = memberData.map(m => m.conversation_id);
    const { data: convs } = await supabase
      .from('conversations')
      .select('*')
      .in('id', convIds)
      .order('updated_at', { ascending: false });

    if (!convs) return;

    // For DM conversations, get the other user's profile
    const enriched = await Promise.all(
      convs.map(async (conv) => {
        if (conv.type === 'dm') {
          const { data: members } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', conv.id)
            .neq('user_id', profile.user_id);

          if (members?.[0]) {
            const { data: otherProfile } = await supabase
              .from('profiles')
              .select('*')
              .eq('user_id', members[0].user_id)
              .single();
            return { ...conv, otherUser: otherProfile || undefined };
          }
        }
        return conv;
      })
    );

    setConversations(enriched);
  };

  const loadPendingCount = async () => {
    if (!profile) return;
    const { count } = await supabase
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .eq('addressee_id', profile.user_id)
      .eq('status', 'pending');
    setPendingCount(count || 0);
  };

  const getConversationName = (conv: Conversation & { otherUser?: Tables<'profiles'> }) => {
    if (conv.type === 'group') return conv.name || 'Group';
    return conv.otherUser?.display_name || 'Unknown';
  };

  const getConversationInitial = (conv: Conversation & { otherUser?: Tables<'profiles'> }) => {
    const name = getConversationName(conv);
    return name.charAt(0).toUpperCase();
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
              onClick={() => navigate('/profile')}
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
            onClick={() => navigate('/profile')}
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

      <CreateGroupDialog open={showCreateGroup} onOpenChange={setShowCreateGroup} onCreated={loadConversations} />
    </>
  );
};

export default ChatSidebar;
