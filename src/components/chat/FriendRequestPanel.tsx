import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, UserPlus, Check, X, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type Friendship = Tables<'friendships'>;

interface FriendRequestPanelProps {
  onClose: () => void;
}

const FriendRequestPanel: React.FC<FriendRequestPanelProps> = ({ onClose }) => {
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<(Friendship & { requester?: Profile })[]>([]);
  const [friends, setFriends] = useState<(Friendship & { friend?: Profile })[]>([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'add' | 'pending' | 'friends'>('add');

  useEffect(() => {
    loadPendingRequests();
    loadFriends();
  }, []);

  const loadPendingRequests = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('*')
      .eq('addressee_id', user.id)
      .eq('status', 'pending');

    if (!data) return;

    const enriched = await Promise.all(
      data.map(async (f) => {
        const { data: p } = await supabase.from('profiles').select('*').eq('user_id', f.requester_id).single();
        return { ...f, requester: p || undefined };
      })
    );
    setPendingRequests(enriched);
  };

  const loadFriends = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('*')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (!data) return;

    const enriched = await Promise.all(
      data.map(async (f) => {
        const friendId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        const { data: p } = await supabase.from('profiles').select('*').eq('user_id', friendId).single();
        return { ...f, friend: p || undefined };
      })
    );
    setFriends(enriched);
  };

  const searchUsers = async () => {
    if (!searchQuery.trim() || !user) return;
    setSearching(true);

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${searchQuery.toLowerCase()}%`)
      .neq('user_id', user.id)
      .limit(10);

    setSearchResults(data || []);
    setSearching(false);
  };

  const sendFriendRequest = async (addresseeId: string) => {
    if (!user) return;
    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id,
      addressee_id: addresseeId,
    });

    if (error) {
      if (error.code === '23505') {
        toast({ title: 'Already sent', description: 'Friend request already exists' });
      } else {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
    } else {
      toast({ title: 'Request sent!' });
      setSearchResults(prev => prev.filter(p => p.user_id !== addresseeId));
    }
  };

  const respondToRequest = async (friendshipId: string, accept: boolean) => {
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
      toast({ title: 'Friend added!' });
    } else {
      await supabase.from('friendships').delete().eq('id', friendshipId);
      toast({ title: 'Request declined' });
    }
    loadPendingRequests();
    loadFriends();
  };

  const startDM = async (friendUserId: string) => {
    if (!user) return;

    // Check if DM already exists
    const { data: myConvs } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (myConvs) {
      for (const mc of myConvs) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', mc.conversation_id)
          .eq('type', 'dm')
          .single();

        if (conv) {
          const { data: otherMember } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', conv.id)
            .eq('user_id', friendUserId)
            .single();

          if (otherMember) {
            toast({ title: 'Conversation exists', description: 'Opening existing DM' });
            return;
          }
        }
      }
    }

    // Create new DM
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ type: 'dm', created_by: user.id })
      .select()
      .single();

    if (convError || !newConv) {
      toast({ title: 'Error', description: 'Failed to create conversation', variant: 'destructive' });
      return;
    }

    // Add both members
    await supabase.from('conversation_members').insert([
      { conversation_id: newConv.id, user_id: user.id },
      { conversation_id: newConv.id, user_id: friendUserId },
    ]);

    toast({ title: 'DM created!' });
  };

  return (
    <div className="flex-1 flex flex-col bg-background animate-slide-in-right">
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
        <h2 className="font-display font-semibold text-foreground">Friends</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['add', 'pending', 'friends'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'add' ? 'Add Friend' : t === 'pending' ? `Pending (${pendingRequests.length})` : `Friends (${friends.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {tab === 'add' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">You can add friends by their unique username</p>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                placeholder="Enter a username..."
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
              <Button onClick={searchUsers} disabled={searching} className="bubble-gradient text-primary-foreground">
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {searchResults.map((result) => (
              <div key={result.id} className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bubble-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
                    {result.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{result.display_name}</p>
                    <p className="text-xs text-muted-foreground">@{result.username}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => sendFriendRequest(result.user_id)}
                  className="bubble-gradient text-primary-foreground"
                >
                  <UserPlus className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === 'pending' && (
          <div className="space-y-3">
            {pendingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No pending requests</p>
            ) : (
              pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bubble-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
                      {req.requester?.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{req.requester?.display_name}</p>
                      <p className="text-xs text-muted-foreground">@{req.requester?.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondToRequest(req.id, true)}
                      className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => respondToRequest(req.id, false)}
                      className="p-2 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No friends yet. Add some!</p>
            ) : (
              friends.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bubble-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
                      {f.friend?.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{f.friend?.display_name}</p>
                      <p className="text-xs text-muted-foreground">@{f.friend?.username}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => f.friend && startDM(f.friend.user_id)}
                    className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FriendRequestPanel;
