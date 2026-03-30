import React, { useState } from 'react';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatArea from '@/components/chat/ChatArea';
import FriendRequestPanel from '@/components/chat/FriendRequestPanel';

const ChatPage = () => {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showFriendRequests, setShowFriendRequests] = useState(false);

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
