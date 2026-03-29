
-- Fix overly permissive INSERT policy on conversation_members
DROP POLICY "Conversation creators can add members" ON public.conversation_members;

CREATE POLICY "Members can add to conversations they belong to"
  ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid()
    )
    OR conversation_id IN (
      SELECT id FROM public.conversations WHERE created_by = auth.uid()
    )
  );
