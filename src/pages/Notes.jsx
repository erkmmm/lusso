/**
 * Notes — everything jotted anywhere, in one place.
 *
 * The per-record feeds on a job and a customer answer "what do I know about
 * this?". This page answers the other question: "what did I write down and
 * where has it got to?" It is also the landing spot for capture with nothing
 * open — the + New menu and the due-to-do push both point here.
 */
import { useSearchParams } from 'react-router-dom';
import { StickyNote } from 'lucide-react';
import NotesFeed from '../components/NotesFeed';

export default function Notes() {
  const [searchParams] = useSearchParams();
  const composing = searchParams.get('new') === '1';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <StickyNote size={22} className="text-amber-500" /> Notes
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Anything that doesn’t fit a measure sheet. Add a date and it turns into a to-do on Today.
        </p>
      </div>

      <NotesFeed scope="all" autoFocus={composing} heading="Everything noted" />
    </div>
  );
}
