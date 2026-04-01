import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Send, Phone, Video, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Message, Profile } from '@/types/db';
import { useToast } from '@/hooks/use-toast';
import { useRealtimeSocket } from '@/hooks/use-realtime-socket';

type ChatMessage = Message & { sender?: Profile | null };

type RealtimeEvent = {
  type?: string;
  data?: {
    conversationId?: string;
    message?: ChatMessage;
  };
};

interface ChatAreaProps {
  conversationId: string;
}

function sortByCreatedAt(messages: ChatMessage[]) {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversationId }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [convName, setConvName] = useState('');
  const [convType, setConvType] = useState('dm');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { socket } = useRealtimeSocket();

  const loadConversation = useCallback(async () => {
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
  }, [conversationId]);

  const loadMessages = useCallback(async () => {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' });
    if (!response.ok) return;

    const payload = await response.json();
    const incomingMessages = (payload.messages || []) as ChatMessage[];
    setMessages(sortByCreatedAt(incomingMessages));
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setConvName('');
    setConvType('dm');

    void Promise.all([loadConversation(), loadMessages()]);
  }, [loadConversation, loadMessages]);

  useEffect(() => {
    if (!socket) return;

    const subscribeToConversation = () => {
      socket.emit('conversation:subscribe', conversationId, (result?: { ok: boolean }) => {
        if (result?.ok) {
          void loadMessages();
        }
      });
    };

    const handleRealtimeEvent = (event: RealtimeEvent) => {
      if (event.type !== 'message.created') return;

      const nextMessage = event.data?.message;
      const nextConversationId = event.data?.conversationId;

      if (!nextMessage?.id || nextConversationId !== conversationId) {
        return;
      }

      setMessages((prev) => {
        const withoutDuplicate = prev.filter((message) => message.id !== nextMessage.id);
        return sortByCreatedAt([...withoutDuplicate, nextMessage]);
      });
    };

    const handleConnect = () => {
      subscribeToConversation();
    };

    socket.on('connect', handleConnect);
    socket.on('realtime:event', handleRealtimeEvent);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.emit('conversation:unsubscribe', conversationId);
      socket.off('connect', handleConnect);
      socket.off('realtime:event', handleRealtimeEvent);
    };
  }, [socket, conversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    const content = newMessage.trim();
    const clientMessageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticId = clientMessageId;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      type: 'text',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender: profile || undefined,
    };

    setNewMessage('');
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          clientMessageId,
        }),
      });

      if (!response.ok) {
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        setNewMessage(content);
        toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
        return;
      }

      const payload = await response.json().catch(() => null);
      const serverMessage = payload?.message as ChatMessage | undefined;

      if (!serverMessage?.id) {
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        void loadMessages();
        return;
      }

      setMessages((prev) => {
        const withoutOptimistic = prev.filter(
          (message) => message.id !== optimisticId && message.id !== serverMessage.id
        );
        return sortByCreatedAt([...withoutOptimistic, serverMessage]);
      });
    } catch {
      setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
      setNewMessage(content);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    }
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
