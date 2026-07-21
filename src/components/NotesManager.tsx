import React, { useState, useEffect } from "react";
import { Book, Plus, Trash2, AlertCircle, CheckCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { Employee, Note } from "../types";
import { fetchNotes, addNote, deleteNote } from "../lib/dbService";
import { motion, AnimatePresence } from "motion/react";

interface NotesManagerProps {
  currentUser: Employee;
}

// Sub-component for displaying a single note card
interface NoteCardProps {
  note: Note;
  onDelete: (noteId: string) => void;
}

function NoteCard({ note, onDelete }: NoteCardProps) {
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const hasLongDescription = note.description && note.description.length > 200;

  return (
    <div key={note.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between gap-4 hover:border-indigo-200 transition-all">
      <div>
        <h3 className="font-bold text-sm text-slate-800">{note.title}</h3>
        {note.description && (
          <>
            <p className={`text-xs text-slate-500 mt-1 whitespace-pre-wrap leading-relaxed ${!isDescExpanded && 'line-clamp-4'}`}>
              {note.description}
            </p>
            {hasLongDescription && (
              <button 
                onClick={() => setIsDescExpanded(!isDescExpanded)} 
                className="text-[10px] font-bold text-indigo-600 hover:underline mt-1 flex items-center gap-1"
              >
                {isDescExpanded ? 'Read Less' : 'Read More'} 
                {isDescExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <span className="text-[10px] text-slate-400 font-mono">
          {new Date(note.createdAt).toLocaleDateString()}
        </span>
        <button onClick={() => onDelete(note.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Delete note">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function NotesManager({ currentUser }: NotesManagerProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showModal, setShowModal] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteDesc, setNoteDesc] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const userNotes = await fetchNotes(currentUser.phone);
      setNotes(userNotes);
    } catch (err: any) {
      setError("Failed to load notes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [currentUser]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim()) {
      setFormError("Note title is required.");
      return;
    }
    setFormLoading(true);
    setFormError(null);
    try {
      await addNote({
        employee_id: currentUser.phone,
        title: noteTitle,
        description: noteDesc,
      });
      setNoteTitle("");
      setNoteDesc("");
      setShowModal(false);
      await loadNotes();
    } catch (err: any) {
      setFormError(err.message || "Failed to save note.");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (window.confirm("Are you sure you want to permanently delete this note?")) {
      try {
        await deleteNote(noteId);
        await loadNotes();
      } catch (err: any) {
        setError(err.message || "Failed to delete note.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Book className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 font-display">My Personal Notes</h2>
            <p className="text-xs text-slate-400">A private space for your thoughts, reminders, and credentials.</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Create New Note
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-10 text-slate-400">Loading notes...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
          <Book className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-semibold text-slate-400">You haven't created any notes yet.</p>
          <p className="text-xs text-slate-400 mt-1">Click "Create New Note" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {notes.map(note => (
            <NoteCard key={note.id} note={note} onDelete={handleDeleteNote} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="fixed inset-0 bg-slate-900/70" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative z-10 w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900">Create a New Note</h3>
                  <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleAddNote} className="mt-4 space-y-4">
                  {formError && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{formError}</div>}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Note Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Meeting Reminders"
                      value={noteTitle}
                      onChange={(e) => setNoteTitle(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Content / Description</label>
                    <textarea
                      rows={5}
                      placeholder="Add your notes here..."
                      value={noteDesc}
                      onChange={(e) => setNoteDesc(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 text-xs font-semibold">
                      Cancel
                    </button>
                    <button type="submit" disabled={formLoading} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md disabled:opacity-50">
                      {formLoading ? "Saving..." : "Save Note"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}