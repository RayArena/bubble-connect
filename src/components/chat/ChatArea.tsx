import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Send,
  Phone,
  Video as VideoIcon,
  Users,
  Paperclip,
  X,
  Download,
  FileText,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Message, MessageAttachment, Profile } from '@/types/db';
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

const MAX_FILES_PER_MESSAGE = 10;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

function sortByCreatedAt(messages: ChatMessage[]) {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';

  if (sizeBytes < 1024) return `${sizeBytes} B`;

  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;

  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;

  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function getAttachmentCategory(attachment: MessageAttachment) {
  if (attachment.category) {
    return attachment.category;
  }

  const mimeType = (attachment.mime_type || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function getAttachmentKey(attachment: MessageAttachment, index: number) {
  return attachment.id || attachment.path || `${attachment.file_name}-${index}`;
}

function getAttachmentViewUrl(attachment: MessageAttachment) {
  if (attachment.id) {
    return `/api/attachments/${encodeURIComponent(attachment.id)}`;
  }

  if (attachment.url) {
    return attachment.url;
  }

  return '#';
}

function getAttachmentDownloadUrl(attachment: MessageAttachment) {
  const viewUrl = getAttachmentViewUrl(attachment);
  if (viewUrl === '#') {
    return '#';
  }

  return viewUrl.includes('?') ? `${viewUrl}&download=1` : `${viewUrl}?download=1`;
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversationId }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [convName, setConvName] = useState('');
  const [convType, setConvType] = useState('dm');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const removePendingFile = (indexToRemove: number) => {
    setPendingFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handlePickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;

    setPendingFiles((prev) => {
      const availableSlots = MAX_FILES_PER_MESSAGE - prev.length;

      if (availableSlots <= 0) {
        toast({
          title: 'File limit reached',
          description: `You can attach up to ${MAX_FILES_PER_MESSAGE} files in a message.`,
          variant: 'destructive',
        });
        return prev;
      }

      const validSizeFiles = selectedFiles.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);
      const oversizedCount = selectedFiles.length - validSizeFiles.length;

      if (oversizedCount > 0) {
        toast({
          title: 'Some files were skipped',
          description: `Files above ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB cannot be sent.`,
          variant: 'destructive',
        });
      }

      const filesToAdd = validSizeFiles.slice(0, availableSlots);
      if (validSizeFiles.length > availableSlots) {
        toast({
          title: 'Too many files selected',
          description: `Only the first ${availableSlots} file(s) were added.`,
          variant: 'destructive',
        });
      }

      return [...prev, ...filesToAdd];
    });

    event.target.value = '';
  };

  const renderAttachment = (attachment: MessageAttachment, isMine: boolean) => {
    const category = getAttachmentCategory(attachment);
    const viewUrl = getAttachmentViewUrl(attachment);
    const downloadUrl = getAttachmentDownloadUrl(attachment);
    const wrapperClass = isMine
      ? 'border-primary/20 bg-primary/5'
      : 'border-border bg-background/80';

    if (category === 'image') {
      return (
        <a href={viewUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={viewUrl}
            alt={attachment.file_name || 'Image attachment'}
            loading="lazy"
            className={`max-h-80 w-full rounded-xl border object-cover ${wrapperClass}`}
          />
        </a>
      );
    }

    if (category === 'video') {
      return (
        <video
          controls
          preload="metadata"
          src={viewUrl}
          className={`max-h-80 w-full rounded-xl border ${wrapperClass}`}
        />
      );
    }

    if (category === 'audio') {
      return (
        <div className={`rounded-xl border p-2 ${wrapperClass}`}>
          <audio controls preload="metadata" src={viewUrl} className="w-full" />
          <p className="mt-1 text-xs text-muted-foreground truncate">{attachment.file_name}</p>
        </div>
      );
    }

    return (
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors hover:bg-secondary/50 ${wrapperClass}`}
      >
        <a href={viewUrl} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.file_name || 'Attachment'}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size_bytes)}</p>
          </div>
        </a>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    );
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSending) return;

    const content = newMessage.trim();
    const files = pendingFiles;
    if (!content && files.length === 0) return;

    const clientMessageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticId = clientMessageId;
    const shouldOptimisticallyRender = files.length === 0 && Boolean(content);

    setNewMessage('');
    setPendingFiles([]);

    if (shouldOptimisticallyRender) {
      const optimisticMessage: ChatMessage = {
        id: optimisticId,
        conversation_id: conversationId,
        sender_id: user.id,
        content,
        type: 'text',
        attachments: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sender: profile || undefined,
      };

      setMessages((prev) => [...prev, optimisticMessage]);
    }

    setIsSending(true);

    try {
      const response = files.length
        ? await fetch(`/api/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: (() => {
              const formData = new FormData();
              formData.set('content', content);
              formData.set('clientMessageId', clientMessageId);
              files.forEach((file) => {
                formData.append('attachments', file);
              });
              return formData;
            })(),
          })
        : await fetch(`/api/conversations/${conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              clientMessageId,
            }),
          });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (shouldOptimisticallyRender) {
          setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        }
        setNewMessage(content);
        setPendingFiles(files);
        toast({
          title: 'Error',
          description: (payload && typeof payload.error === 'string' && payload.error) || 'Failed to send message',
          variant: 'destructive',
        });
        return;
      }

      const serverMessage = payload?.message as ChatMessage | undefined;

      if (!serverMessage?.id) {
        if (shouldOptimisticallyRender) {
          setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        }
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
      if (shouldOptimisticallyRender) {
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
      }
      setNewMessage(content);
      setPendingFiles(files);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } finally {
      setIsSending(false);
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
            <VideoIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && (
                  <p className="text-xs text-muted-foreground mb-1 ml-1">
                    {msg.sender?.display_name || 'Unknown'}
                  </p>
                )}
                <div className={isMine ? 'chat-bubble-sent px-3 py-2' : 'chat-bubble-received px-3 py-2'}>
                  {attachments.length > 0 && (
                    <div className="space-y-2">
                      {attachments.map((attachment, index) => (
                        <div key={getAttachmentKey(attachment, index)}>
                          {renderAttachment(attachment, isMine)}
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.content ? (
                    <p className={`text-sm whitespace-pre-wrap break-words ${attachments.length ? 'mt-2' : ''}`}>
                      {msg.content}
                    </p>
                  ) : null}
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />

        {pendingFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1"
              >
                <span className="max-w-[180px] truncate text-xs text-foreground">{file.name}</span>
                <span className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removePendingFile(index)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePickFiles}
            disabled={isSending || pendingFiles.length >= MAX_FILES_PER_MESSAGE}
            className="p-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            title="Attach files"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message or attach files..."
            disabled={isSending}
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={isSending || (!newMessage.trim() && pendingFiles.length === 0)}
            className="p-2.5 rounded-lg bubble-gradient text-primary-foreground disabled:opacity-50 transition-opacity"
          >
            <Send className={`w-4 h-4 ${isSending ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatArea;
