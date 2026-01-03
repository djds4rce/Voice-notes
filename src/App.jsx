/**
 * Voice Notes App
 * 
 * Main application with React Router and integrated services.
 * Manages:
 * - Model loading (Whisper for transcription)
 * - Database operations (PGlite)
 * - Routing between pages
 */

import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';

// Components
import { NotesListPage } from './components/NotesListPage';
import { RecordingScreen } from './components/RecordingScreen';
import { UploadScreen } from './components/UploadScreen';
import { AudioPlayerV2 as AudioPlayer } from './components/AudioPlayerV2';
import { SettingsPage } from './components/SettingsPage';

// Services
import DatabaseService from './services/DatabaseService';
import EmbeddingService from './services/EmbeddingService';

// Hooks
import { useWhisperModel, DEVICE } from './hooks/useWhisperModel';

// Context
import { SettingsProvider, useSettings } from './contexts/SettingsContext';

// Styles
import './App.css';


function AppContent() {
  const navigate = useNavigate();

  // Whisper model loading (custom hook handles worker, loading, and auto-preload)
  const {
    worker,
    status,
    loadingMessage,
    progressItems,
  } = useWhisperModel();

  // Service instances
  const [db, setDb] = useState(null);

  // Notes state
  const [notes, setNotes] = useState([]);
  const [currentNote, setCurrentNote] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDbLoading, setIsDbLoading] = useState(true);

  // Embedding model loading state for search
  const [embeddingStatus, setEmbeddingStatus] = useState(null);

  // Get settings from context
  const {
    semanticSearchEnabled,
    isEnglish,
  } = useSettings();

  // Initialize database
  useEffect(() => {
    async function initDb() {
      try {
        setIsDbLoading(true);
        const dbInstance = await DatabaseService.getInstance();
        setDb(dbInstance);
        // Load initial notes
        const allNotes = await dbInstance.getAllNotes();
        setNotes(allNotes);
      } catch (error) {
        console.error('[App] Failed to initialize database:', error);
      } finally {
        setIsDbLoading(false);
      }
    }
    initDb();
  }, []);

  // Save a new note
  const handleSaveNote = useCallback(async ({ transcript, audioBlob, durationSeconds, wordTimestamps, tags }) => {
    if (!db) return;

    try {
      const note = await db.createNote({
        transcript,
        audioBlob,
        durationSeconds,
        wordTimestamps,
        tags,
      });

      // Refresh notes list
      const allNotes = await db.getAllNotes();
      setNotes(allNotes);

    } catch (error) {
      console.error('[App] Failed to save note:', error);
    }
  }, [db]);

  // Delete a note
  const handleDeleteNote = useCallback(async (noteId) => {
    if (!db) return;

    try {
      await db.deleteNote(noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (error) {
      console.error('[App] Failed to delete note:', error);
    }
  }, [db]);

  // Get note by ID with audio
  const getNoteWithAudio = useCallback(async (noteId) => {
    if (!db) return null;

    try {
      const note = await db.getNoteById(noteId);
      setCurrentNote(note);
      return note;
    } catch (error) {
      console.error('[App] Failed to get note:', error);
      return null;
    }
  }, [db]);

  // Keyword search
  const handleKeywordSearch = useCallback(async (query) => {
    if (!db) return [];

    try {
      setIsSearching(true);
      const results = await db.keywordSearch(query);
      setIsSearching(false);
      return results;
    } catch (error) {
      console.error('[App] Keyword search failed:', error);
      setIsSearching(false);
      return [];
    }
  }, [db]);

  // Semantic search using embeddings
  const handleSemanticSearch = useCallback(async (query) => {
    if (!db || !notes.length) return [];

    try {
      setIsSearching(true);

      // Get embedding service and embed the query
      // Show loading status if model isn't loaded yet
      if (embeddingStatus !== 'ready') {
        setEmbeddingStatus('loading');
      }
      const embeddingService = await EmbeddingService.getInstance(null, DEVICE);
      setEmbeddingStatus('ready');
      const queryEmbedding = await embeddingService.embed(query);

      // Compute similarity for all notes
      const resultsWithScores = await Promise.all(
        notes.map(async (note) => {
          try {
            // Generate embedding for note transcript
            const noteEmbedding = await embeddingService.embed(note.transcript);
            const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, noteEmbedding);
            return { ...note, similarity };
          } catch (error) {
            console.error('[App] Failed to embed note:', note.id, error);
            return { ...note, similarity: 0 };
          }
        })
      );

      // Filter by minimum similarity threshold and sort by relevance
      // Using a lower threshold (0.15) to capture semantic relationships
      // all-MiniLM-L6-v2 produces lower scores for semantic similarity vs exact matches
      const SIMILARITY_THRESHOLD = 0.15;
      const results = resultsWithScores
        .filter(note => note.similarity >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity);

      setIsSearching(false);
      return results;
    } catch (error) {
      console.error('[App] Semantic search failed:', error);
      setIsSearching(false);
      // Fall back to keyword search
      return handleKeywordSearch(query);
    }
  }, [db, notes, handleKeywordSearch]);

  // Play note audio
  const handlePlayNote = useCallback(async (note) => {
    const noteWithAudio = await getNoteWithAudio(note.id);
    if (noteWithAudio) {
      navigate(`/note/${note.id}`, { state: { autoplay: true } });
    }
  }, [getNoteWithAudio, navigate]);

  // WebGPU block removed - app now works with WASM fallback

  // Main app routes
  return (
    <div className="app-container">
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/notes" replace />}
        />
        <Route
          path="/notes"
          element={
            <NotesListPage
              notes={notes}
              onDeleteNote={handleDeleteNote}
              onPlayNote={handlePlayNote}
              onSemanticSearch={handleSemanticSearch}
              onKeywordSearch={handleKeywordSearch}
              semanticSearchEnabled={isEnglish && semanticSearchEnabled}
              isSearching={isSearching}
              isEmbeddingLoading={embeddingStatus === 'loading'}
              isLoading={isDbLoading}
            />
          }
        />
        <Route
          path="/record"
          element={
            <RecordingScreen
              worker={worker.current}
              onSaveNote={handleSaveNote}
              whisperStatus={status}
              progressItems={progressItems}
              loadingMessage={loadingMessage}
            />
          }
        />
        <Route
          path="/settings"
          element={<SettingsPage />}
        />
        <Route
          path="/upload"
          element={
            <UploadScreen
              worker={worker.current}
              onSaveNote={handleSaveNote}
              whisperStatus={status}
              progressItems={progressItems}
              loadingMessage={loadingMessage}
            />
          }
        />
        <Route
          path="/note/:id"
          element={
            <NoteDetailPage
              getNoteWithAudio={getNoteWithAudio}
              currentNote={currentNote}
            />
          }
        />
        {/* Redirect /search to notes page since search is now inline */}
        <Route
          path="/search"
          element={<Navigate to="/notes" replace />}
        />
      </Routes>
    </div>
  );
}

// Wrapper component to load note by ID
function NoteDetailPage({ getNoteWithAudio, currentNote }) {
  const { id } = useParams();
  const [note, setNote] = useState(currentNote);

  useEffect(() => {
    if (!note || note.id !== parseInt(id)) {
      getNoteWithAudio(parseInt(id)).then(setNote);
    }
  }, [id, note, getNoteWithAudio]);

  return <AudioPlayer note={note} />;
}

// Import useParams
import { useParams } from 'react-router-dom';

function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </SettingsProvider>
  );
}

export default App;
