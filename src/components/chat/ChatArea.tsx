import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Pencil,
  Forward,
  Trash2,
  CheckSquare,
  Image as ImageIcon,
  Film,
  File as FileIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Conversation, Message, MessageAttachment, Profile } from '@/types/db';
import { useToast } from '@/hooks/use-toast';
import { useRealtimeSocket } from '@/hooks/use-realtime-socket';

type ChatMessage = Message & { sender?: Profile | null };
type ConversationOption = Conversation & { otherUser?: Profile | null };

type RealtimeEvent = {
  type?: string;
  data?: {
    conversationId?: string;
    messageId?: string;
    message?: ChatMessage;
  };
};

interface ChatAreaProps {
  conversationId: string;
}

const MAX_FILES_PER_MESSAGE = 10;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const DOCUMENT_ACCEPT_LIST = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z';

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

function getConversationDisplayName(conversation: ConversationOption) {
  if (conversation.type === 'group') {
    return conversation.name || 'Group';
  }

  return conversation.otherUser?.display_name || 'Direct message';
}

function isInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('a,button,input,textarea,select,label,video,audio'));
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversationId }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileInputAccept, setFileInputAccept] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [convName, setConvName] = useState('');
  const [convType, setConvType] = useState('dm');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingMessages, setIsDeletingMessages] = useState(false);
  const [isForwardDialogOpen, setIsForwardDialogOpen] = useState(false);
  const [forwardMessageIds, setForwardMessageIds] = useState<string[]>([]);
  const [forwardTargetConversationId, setForwardTargetConversationId] = useState('');
  const [isForwarding, setIsForwarding] = useState(false);
  const [forwardTargets, setForwardTargets] = useState<ConversationOption[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { socket } = useRealtimeSocket();

  const isSelectionMode = selectedMessageIds.length > 0;

  const selectedMessageIdSet = useMemo(() => {
    return new Set(selectedMessageIds);
  }, [selectedMessageIds]);

  const selectedMessages = useMemo(() => {
    return messages.filter((message) => selectedMessageIdSet.has(message.id));
  }, [messages, selectedMessageIdSet]);

  const deletableSelectedMessageIds = useMemo(() => {
    return selectedMessages
      .filter((message) => message.sender_id === user?.id)
      .map((message) => message.id);
  }, [selectedMessages, user?.id]);

  const hasMessagesNotOwnedByUser = useMemo(() => {
    return selectedMessages.some((message) => message.sender_id !== user?.id);
  }, [selectedMessages, user?.id]);

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

  const loadForwardTargets = useCallback(async () => {
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) return;

    const payload = await response.json();
    const conversationList = (payload.conversations || []) as ConversationOption[];
    setForwardTargets(conversationList.filter((conversation) => conversation.id !== conversationId));
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setConvName('');
    setConvType('dm');
    setPendingFiles([]);
    setFileInputAccept('');
    setSelectedMessageIds([]);
    setEditingMessageId(null);
    setEditingMessageContent('');
    setIsForwardDialogOpen(false);
    setForwardMessageIds([]);
    setForwardTargetConversationId('');

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
      const eventType = event.type;
      const nextConversationId = event.data?.conversationId;

      if (nextConversationId !== conversationId) {
        return;
      }

      if (eventType === 'message.created') {
        const nextMessage = event.data?.message;
        if (!nextMessage?.id) {
          return;
        }

        setMessages((prev) => {
          const withoutDuplicate = prev.filter((message) => message.id !== nextMessage.id);
          return sortByCreatedAt([...withoutDuplicate, nextMessage]);
        });

        return;
      }

      if (eventType === 'message.updated') {
        const nextMessage = event.data?.message;
        if (!nextMessage?.id) {
          return;
        }

        setMessages((prev) => {
          const exists = prev.some((message) => message.id === nextMessage.id);
          if (!exists) {
            return prev;
          }

          return sortByCreatedAt(
            prev.map((message) => (message.id === nextMessage.id ? { ...message, ...nextMessage } : message))
          );
        });

        return;
      }

      if (eventType === 'message.deleted') {
        const deletedMessageId = event.data?.messageId;
        if (!deletedMessageId) {
          return;
        }

        setMessages((prev) => prev.filter((message) => message.id !== deletedMessageId));
        setSelectedMessageIds((prev) => prev.filter((messageId) => messageId !== deletedMessageId));
        setEditingMessageId((prev) => (prev === deletedMessageId ? null : prev));
      }
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

  useEffect(() => {
    if (!isForwardDialogOpen) {
      return;
    }

    void loadForwardTargets();
  }, [isForwardDialogOpen, loadForwardTargets]);

  useEffect(() => {
    if (!isForwardDialogOpen || forwardTargetConversationId || !forwardTargets.length) {
      return;
    }

    setForwardTargetConversationId(forwardTargets[0].id);
  }, [isForwardDialogOpen, forwardTargetConversationId, forwardTargets]);

  const removePendingFile = (indexToRemove: number) => {
    setPendingFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const openFilePickerFor = (accept: string) => {
    setFileInputAccept(accept);

    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) {
      setFileInputAccept('');
      return;
    }

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

    setFileInputAccept('');
    event.target.value = '';
  };

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    );
  }, []);

  const startSelectionWithMessage = (messageId: string) => {
    setSelectedMessageIds((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]));
  };

  const clearSelection = () => {
    setSelectedMessageIds([]);
  };

  const beginEditMessage = (message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditingMessageContent(message.content || '');
    clearSelection();
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageContent('');
  };

  const saveEditedMessage = async () => {
    if (!editingMessageId || isSavingEdit || !user) {
      return;
    }

    const originalMessage = messages.find((message) => message.id === editingMessageId);
    if (!originalMessage || originalMessage.sender_id !== user.id) {
      cancelEditMessage();
      return;
    }

    const nextContent = editingMessageContent.trim();
    const hasAttachments = Array.isArray(originalMessage.attachments) && originalMessage.attachments.length > 0;

    if (!nextContent && !hasAttachments) {
      toast({
        title: 'Message cannot be empty',
        description: 'Type a message to save your edit.',
        variant: 'destructive',
      });
      return;
    }

    setIsSavingEdit(true);

    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/messages/${encodeURIComponent(editingMessageId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: nextContent }),
        }
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast({
          title: 'Unable to edit message',
          description:
            (payload && typeof payload.error === 'string' && payload.error) ||
            'Please try again in a moment.',
          variant: 'destructive',
        });
        return;
      }

      const updatedMessage = payload?.message as ChatMessage | undefined;
      if (!updatedMessage?.id) {
        void loadMessages();
        cancelEditMessage();
        return;
      }

      setMessages((prev) =>
        sortByCreatedAt(prev.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)))
      );

      cancelEditMessage();
      toast({
        title: 'Message updated',
        description: 'Your message was edited successfully.',
      });
    } catch {
      toast({
        title: 'Unable to edit message',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteMessages = useCallback(
    async (messageIds: string[]) => {
      if (!user || isDeletingMessages) {
        return;
      }

      const uniqueIds = Array.from(new Set(messageIds));
      if (!uniqueIds.length) {
        return;
      }

      const deletableIds = uniqueIds.filter((messageId) => {
        const message = messages.find((item) => item.id === messageId);
        return Boolean(message && message.sender_id === user.id);
      });

      const skippedBeforeDelete = uniqueIds.length - deletableIds.length;

      if (!deletableIds.length) {
        toast({
          title: 'Nothing to delete',
          description: 'You can delete only messages sent by you.',
          variant: 'destructive',
        });
        return;
      }

      setIsDeletingMessages(true);

      let deletedCount = 0;
      let failedCount = 0;

      for (const messageId of deletableIds) {
        try {
          const response = await fetch(
            `/api/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}`,
            {
              method: 'DELETE',
            }
          );

          if (!response.ok) {
            failedCount += 1;
            continue;
          }

          deletedCount += 1;
          setMessages((prev) => prev.filter((message) => message.id !== messageId));
          setSelectedMessageIds((prev) => prev.filter((id) => id !== messageId));
          setEditingMessageId((prev) => (prev === messageId ? null : prev));
        } catch {
          failedCount += 1;
        }
      }

      setIsDeletingMessages(false);

      if (deletedCount > 0) {
        toast({
          title: 'Messages deleted',
          description: `${deletedCount} message${deletedCount === 1 ? '' : 's'} deleted.`,
        });
      }

      const unresolvedCount = skippedBeforeDelete + failedCount;
      if (unresolvedCount > 0) {
        toast({
          title: 'Some messages were not deleted',
          description: `${unresolvedCount} message${unresolvedCount === 1 ? '' : 's'} skipped or failed.`,
          variant: deletedCount > 0 ? undefined : 'destructive',
        });
      }
    },
    [user, isDeletingMessages, messages, conversationId, toast]
  );

  const handleDeleteSingleMessage = async (messageId: string) => {
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) {
      return;
    }

    await deleteMessages([messageId]);
  };

  const handleDeleteSelectedMessages = async () => {
    if (!selectedMessageIds.length) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${deletableSelectedMessageIds.length} selected message${
        deletableSelectedMessageIds.length === 1 ? '' : 's'
      }?`
    );

    if (!confirmed) {
      return;
    }

    await deleteMessages(selectedMessageIds);
    clearSelection();
  };

  const openForwardDialogForMessages = (messageIds: string[]) => {
    const uniqueMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (!uniqueMessageIds.length) {
      return;
    }

    setForwardMessageIds(uniqueMessageIds);
    setIsForwardDialogOpen(true);
  };

  const closeForwardDialog = () => {
    setIsForwardDialogOpen(false);
    setForwardMessageIds([]);
    setForwardTargetConversationId('');
  };

  const forwardSelectedMessages = async () => {
    if (!forwardTargetConversationId || !forwardMessageIds.length || isForwarding) {
      return;
    }

    setIsForwarding(true);

    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetConversationId: forwardTargetConversationId,
          messageIds: forwardMessageIds,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast({
          title: 'Unable to forward messages',
          description:
            (payload && typeof payload.error === 'string' && payload.error) ||
            'Please try again in a moment.',
          variant: 'destructive',
        });
        return;
      }

      const forwardedMessages = Array.isArray(payload?.messages)
        ? (payload.messages as ChatMessage[])
        : [];

      if (forwardTargetConversationId === conversationId && forwardedMessages.length) {
        setMessages((prev) => {
          const next = [...prev];

          forwardedMessages.forEach((message) => {
            if (!next.some((existingMessage) => existingMessage.id === message.id)) {
              next.push(message);
            }
          });

          return sortByCreatedAt(next);
        });
      }

      toast({
        title: 'Messages forwarded',
        description: `${forwardMessageIds.length} message${forwardMessageIds.length === 1 ? '' : 's'} forwarded.`,
      });

      closeForwardDialog();
      clearSelection();
    } catch {
      toast({
        title: 'Unable to forward messages',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setIsForwarding(false);
    }
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
            className={`max-h-80 w-full rounded-xl attachment-border object-cover ${wrapperClass}`}
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
          className={`max-h-80 w-full rounded-xl attachment-border ${wrapperClass}`}
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
          description:
            (payload && typeof payload.error === 'string' && payload.error) || 'Failed to send message',
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

  const onMessageClick = (event: React.MouseEvent<HTMLDivElement>, messageId: string) => {
    if (!isSelectionMode) {
      return;
    }

    if (isInteractiveElement(event.target)) {
      return;
    }

    event.preventDefault();
    toggleMessageSelection(messageId);
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
          const isSelected = selectedMessageIdSet.has(msg.id);
          const isEditing = editingMessageId === msg.id;

          return (
            <ContextMenu key={msg.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`group flex w-full gap-2 ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`}
                  onClick={(event) => onMessageClick(event, msg.id)}
                >
                  {isSelectionMode && !isMine ? (
                    <div className="flex items-center">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleMessageSelection(msg.id)}
                        aria-label="Select message"
                      />
                    </div>
                  ) : null}

                  <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'}`}>
                    {!isMine && (
                      <p className="text-xs text-muted-foreground mb-1 ml-1">
                        {msg.sender?.display_name || 'Unknown'}
                      </p>
                    )}
                    <div
                      className={`${isMine ? 'chat-bubble-sent' : 'chat-bubble-received'} px-3 py-2 transition-shadow ${
                        isSelected ? 'ring-2 ring-primary/40' : ''
                      }`}
                    >
                      {attachments.length > 0 && (
                        <div className="space-y-2">
                          {attachments.map((attachment, index) => (
                            <div key={getAttachmentKey(attachment, index)}>
                              {renderAttachment(attachment, isMine)}
                            </div>
                          ))}
                        </div>
                      )}

                      {isEditing ? (
                        <div className={attachments.length > 0 ? 'mt-2 space-y-2' : 'space-y-2'}>
                          <Textarea
                            value={editingMessageContent}
                            onChange={(event) => setEditingMessageContent(event.target.value)}
                            className="min-h-[90px] bg-background/80 border-border text-foreground"
                            placeholder="Edit your message"
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditMessage}
                              disabled={isSavingEdit}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void saveEditedMessage()}
                              disabled={isSavingEdit}
                            >
                              {isSavingEdit ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </div>
                      ) : msg.content ? (
                        <p className={`text-sm whitespace-pre-wrap break-words ${attachments.length ? 'mt-2' : ''}`}>
                          {msg.content}
                        </p>
                      ) : null}
                    </div>
                    <p className={`text-[10px] text-muted-foreground mt-1 ${isMine ? 'text-right mr-1' : 'ml-1'}`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>

                  {isSelectionMode && isMine ? (
                    <div className="flex items-center">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleMessageSelection(msg.id)}
                        aria-label="Select message"
                      />
                    </div>
                  ) : null}
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent className="w-48">
                <ContextMenuLabel>Message actions</ContextMenuLabel>
                {isMine ? (
                  <ContextMenuItem onClick={() => beginEditMessage(msg)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem onClick={() => openForwardDialogForMessages([msg.id])}>
                  <Forward className="mr-2 h-4 w-4" />
                  Forward
                </ContextMenuItem>
                <ContextMenuItem onClick={() => startSelectionWithMessage(msg.id)}>
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Select
                </ContextMenuItem>
                {isMine ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => void handleDeleteSingleMessage(msg.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </ContextMenuItem>
                  </>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {isSelectionMode ? (
        <div className="border-t border-border bg-card/90 px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {selectedMessageIds.length} selected
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openForwardDialogForMessages(selectedMessageIds)}
              >
                <Forward className="h-4 w-4" />
                Forward
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void handleDeleteSelectedMessages()}
                disabled={isDeletingMessages || !deletableSelectedMessageIds.length}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                Cancel
              </Button>
            </div>
          </div>
          {hasMessagesNotOwnedByUser ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Only your own messages can be deleted.
            </p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={sendMessage} className="p-4 border-t border-border">
        <input
          ref={fileInputRef}
          type="file"
          accept={fileInputAccept || undefined}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={isSending || pendingFiles.length >= MAX_FILES_PER_MESSAGE}
                className="p-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                title="Attach files"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              <DropdownMenuItem onClick={() => openFilePickerFor('image/*')}>
                <ImageIcon className="mr-2 h-4 w-4" />
                Image
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openFilePickerFor('video/*')}>
                <Film className="mr-2 h-4 w-4" />
                Video
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openFilePickerFor(DOCUMENT_ACCEPT_LIST)}>
                <FileIcon className="mr-2 h-4 w-4" />
                Document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

      <Dialog open={isForwardDialogOpen} onOpenChange={(open) => (open ? setIsForwardDialogOpen(true) : closeForwardDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Forward messages</DialogTitle>
            <DialogDescription>
              Choose where to forward {forwardMessageIds.length} message{forwardMessageIds.length === 1 ? '' : 's'}.
            </DialogDescription>
          </DialogHeader>

          {forwardTargets.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="forward-conversation">Conversation</Label>
              <select
                id="forward-conversation"
                value={forwardTargetConversationId}
                onChange={(event) => setForwardTargetConversationId(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {forwardTargets.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {getConversationDisplayName(conversation)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You need at least one other conversation to forward messages.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeForwardDialog} disabled={isForwarding}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void forwardSelectedMessages()}
              disabled={isForwarding || !forwardTargetConversationId || !forwardMessageIds.length || !forwardTargets.length}
            >
              {isForwarding
                ? 'Forwarding...'
                : `Forward ${forwardMessageIds.length} message${forwardMessageIds.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatArea;
