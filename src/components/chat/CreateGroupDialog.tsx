import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Profile } from '@/types/db';

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
    const response = await fetch('/api/friends', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    setFriends(payload.friends || []);
  };

  const toggleFriend = (userId: string) => {
    setSelectedFriends(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedFriends.length === 0 || !user) return;
    setCreating(true);

    const response = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'group',
        name: groupName.trim(),
        memberIds: selectedFriends,
      }),
    });

    if (!response.ok) {
      toast({ title: 'Error', description: 'Failed to create group', variant: 'destructive' });
      setCreating(false);
      return;
    }

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
