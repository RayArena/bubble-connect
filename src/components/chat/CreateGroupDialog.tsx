import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const CreateGroupDialog: React.FC<CreateGroupDialogProps> = ({ open, onOpenChange, onCreated }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [groupName, setGroupName] = useState('');
  const [friends, setFriends] = useState<Profile[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) loadFriends();
  }, [open]);

  const loadFriends = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('*')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (!data) return;

    const friendProfiles = await Promise.all(
      data.map(async (f) => {
        const friendId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        const { data: p } = await supabase.from('profiles').select('*').eq('user_id', friendId).single();
        return p;
      })
    );

    setFriends(friendProfiles.filter(Boolean) as Profile[]);
  };

  const toggleFriend = (userId: string) => {
    setSelectedFriends(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedFriends.length === 0 || !user) return;
    setCreating(true);

    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ type: 'group', name: groupName.trim(), created_by: user.id })
      .select()
      .single();

    if (error || !conv) {
      toast({ title: 'Error', description: 'Failed to create group', variant: 'destructive' });
      setCreating(false);
      return;
    }

    // Add creator and selected friends
    const members = [user.id, ...selectedFriends].map(uid => ({
      conversation_id: conv.id,
      user_id: uid,
      role: uid === user.id ? 'admin' : 'member',
    }));

    await supabase.from('conversation_members').insert(members);

    toast({ title: 'Group created!' });
    setGroupName('');
    setSelectedFriends([]);
    onOpenChange(false);
    onCreated();
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="font-display">Create Group</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground">Group Name</Label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name..."
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Add Friends</Label>
            <div className="max-h-48 overflow-y-auto space-y-2 scrollbar-thin">
              {friends.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add friends first to create a group</p>
              ) : (
                friends.map((f) => (
                  <label
                    key={f.user_id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedFriends.includes(f.user_id)}
                      onCheckedChange={() => toggleFriend(f.user_id)}
                    />
                    <div className="w-8 h-8 rounded-full bubble-gradient flex items-center justify-center text-xs font-bold text-primary-foreground">
                      {f.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{f.display_name}</p>
                      <p className="text-xs text-muted-foreground">@{f.username}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          <Button
            onClick={createGroup}
            disabled={!groupName.trim() || selectedFriends.length === 0 || creating}
            className="w-full bubble-gradient text-primary-foreground"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Create Group ({selectedFriends.length} members)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateGroupDialog;
