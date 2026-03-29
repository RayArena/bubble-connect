import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

const ProfilePage = () => {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, bio })
      .eq('user_id', profile.user_id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Profile updated!' });
      await refreshProfile();
    }
    setSaving(false);
  };

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-6 animate-fade-in">
        <button onClick={() => navigate('/chat')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to chats
        </button>

        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-full bubble-gradient mx-auto mb-4 flex items-center justify-center text-4xl font-display font-bold text-primary-foreground">
            {displayName?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">{displayName}</h1>
          <p className="text-muted-foreground text-sm">@{profile.username}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground">Username</Label>
            <Input value={profile.username} disabled className="bg-muted border-border text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Username cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-secondary border-border text-foreground"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Bio</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="bg-secondary border-border text-foreground resize-none"
              rows={3}
              maxLength={200}
              placeholder="Tell others about yourself..."
            />
          </div>

          <Button onClick={handleSave} className="w-full bubble-gradient text-primary-foreground" disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </div>

        <Button
          variant="ghost"
          onClick={signOut}
          className="w-full mt-4 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
};

export default ProfilePage;
