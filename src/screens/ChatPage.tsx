import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatArea from '@/components/chat/ChatArea';
import FriendRequestPanel from '@/components/chat/FriendRequestPanel';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

const ChatPage = () => {
  const { profile } = useAuth();
  const router = useRouter();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showFriendRequests, setShowFriendRequests] = useState(false);

  if (profile?.is_deleted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-6 text-center space-y-4">
          <h1 className="text-xl font-display font-bold text-foreground">Profile Scheduled For Deletion</h1>
          <p className="text-sm text-muted-foreground">
            Your account is in recovery mode. Restore your profile to continue chatting.
          </p>
          <Button onClick={() => router.push('/profile')} className="w-full bubble-gradient text-primary-foreground">
            Go To Profile Recovery
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <ChatSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onToggleFriendRequests={() => setShowFriendRequests(!showFriendRequests)}
        showFriendRequests={showFriendRequests}
      />
      <div className="flex-1 flex">
        {showFriendRequests ? (
          <FriendRequestPanel onClose={() => setShowFriendRequests(false)} />
        ) : activeConversationId ? (
          <ChatArea conversationId={activeConversationId} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center animate-fade-in">
              <div className="w-20 h-20 rounded-full bubble-gradient mx-auto mb-4 flex items-center justify-center bubble-glow">
                <span className="text-3xl">💬</span>
              </div>
              <h2 className="text-xl font-display font-semibold text-foreground">Welcome to Bubble</h2>
              <p className="text-muted-foreground mt-2">Select a conversation or add friends to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;
