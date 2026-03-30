import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Send, Phone, Video, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Message, Profile } from '@/types/db';
import { useToast } from '@/hooks/use-toast';

interface ChatAreaProps {
  conversationId: string;
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversationId }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<(Message & { sender?: Profile })[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [convName, setConvName] = useState('');
  const [convType, setConvType] = useState('dm');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      await loadConversation();
      await loadMessages();
    };

    void hydrate();

    const interval = setInterval(() => {
      if (mounted) {
        void loadMessages();
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversation = async () => {
    const response = await fetch(`/api/conversations/${conversationId}`, { cache: 'no-store' });
    if (!response.ok) return;

    const payload = await response.json();
    const conv = payload.conversation;
    if (!conv) return;

    setConvType(conv.type);
    if (conv.type === 'group') {
      setConvName(conv.name || 'Group');
      return;
    }

    setConvName(payload.otherUser?.display_name || 'Unknown');
  };

  const loadMessages = async () => {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    setMessages(payload.messages || []);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    const content = newMessage.trim();
    setNewMessage('');

    const response = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
      }),
    });

    if (!response.ok) {
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
      return;
    }

    await loadMessages();
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Chat header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bubble-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
            {convType === 'group' ? <Users className="w-4 h-4" /> : convName.charAt(0)?.toUpperCase()}
          </div>
          <span className="font-semibold text-foreground">{convName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toast({ title: 'Voice Call', description: 'Voice calls coming soon!' })}
            className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => toast({ title: 'Video Call', description: 'Video calls coming soon!' })}
            className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <Video className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[70%] ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && (
                  <p className="text-xs text-muted-foreground mb-1 ml-1">
                    {msg.sender?.display_name || 'Unknown'}
                  </p>
                )}
                <div className={isMine ? 'chat-bubble-sent px-4 py-2' : 'chat-bubble-received px-4 py-2'}>
                  <p className="text-sm">{msg.content}</p>
                </div>
                <p className={`text-[10px] text-muted-foreground mt-1 ${isMine ? 'text-right mr-1' : 'ml-1'}`}>
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <form onSubmit={sendMessage} className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="p-2.5 rounded-lg bubble-gradient text-primary-foreground disabled:opacity-50 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatArea;
