/**
 * Voice Notes App
 * 
 * Main application with React Router and integrated services.
 * Manages:
 * - Model loading (Whisper for transcription)
 * - Database operations (PGlite)
 * - Routing between pages
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';

// Components
import { NotesListPage } from './components/NotesListPage';
import { RecordingScreen } from './components/RecordingScreen';
import { AudioPlayerV2 as AudioPlayer } from './components/AudioPlayerV2';
import { SearchPage } from './components/SearchPage';
import Progress from './components/Progress';

// Services
import DatabaseService from './services/DatabaseService';
import EmbeddingService from './services/EmbeddingService';

// Styles
import './App.css';

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;

function AppContent() {
  const navigate = useNavigate();

  // Worker reference for Whisper transcription
  const worker = useRef(null);

  // Service instances
  const [db, setDb] = useState(null);

  // Model loading state
  const [status, setStatus] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [progressItems, setProgressItems] = useState([]);

  // Notes state
  const [notes, setNotes] = useState([]);
  const [currentNote, setCurrentNote] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDbLoading, setIsDbLoading] = useState(true);

  // Embedding model loading state for search
  const [embeddingStatus, setEmbeddingStatus] = useState(null);

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
        console.log('[App] Database initialized, loaded', allNotes.length, 'notes');
      } catch (error) {
        console.error('[App] Failed to initialize database:', error);
      } finally {
        setIsDbLoading(false);
      }
    }
    initDb();
  }, []);

  // Setup worker for Whisper
  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL('./worker.js', import.meta.url), {
        type: 'module',
      });
    }

    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case 'loading':
          setStatus('loading');
          setLoadingMessage(e.data.data);
          break;

        case 'initiate':
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case 'progress':
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            }),
          );
          break;

        case 'done':
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;

        case 'ready':
          setStatus('ready');
          break;
      }
    };

    worker.current.addEventListener('message', onMessageReceived);

    return () => {
      worker.current.removeEventListener('message', onMessageReceived);
    };
  }, []);

  // Load Whisper model
  const loadModel = useCallback(() => {
    if (status !== null) return; // Already loading or loaded
    worker.current?.postMessage({ type: 'load' });
    setStatus('loading');
  }, [status]);

  // Auto-load model on mount (only once)
  const hasTriggeredLoad = useRef(false);
  useEffect(() => {
    if (IS_WEBGPU_AVAILABLE && !hasTriggeredLoad.current) {
      hasTriggeredLoad.current = true;
      loadModel();
    }
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

      console.log('[App] Saved note:', note.id);
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
      console.log('[App] Deleted note:', noteId);
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
      console.log('[App] Starting semantic search for:', query);

      // Get embedding service and embed the query
      // Show loading status if model isn't loaded yet
      if (embeddingStatus !== 'ready') {
        setEmbeddingStatus('loading');
      }
      const embeddingService = await EmbeddingService.getInstance();
      setEmbeddingStatus('ready');
      const queryEmbedding = await embeddingService.embed(query);

      // Compute similarity for all notes
      const resultsWithScores = await Promise.all(
        notes.map(async (note) => {
          try {
            // Generate embedding for note transcript
            const noteEmbedding = await embeddingService.embed(note.transcript);
            const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, noteEmbedding);
            console.log(`[App] Note "${note.title}" similarity: ${similarity.toFixed(4)}`);
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

      console.log('[App] Semantic search found', results.length, 'results (threshold:', SIMILARITY_THRESHOLD, ')');
      console.log('[App] Top scores:', resultsWithScores.slice(0, 5).map(n => `${n.title}: ${n.similarity.toFixed(3)}`));
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

  // Check if WebGPU is available - show error if not
  if (!IS_WEBGPU_AVAILABLE) {
    return (
      <div className="app-container center">
        <div className="error-message">
          WebGPU is not supported by this browser. Please use a compatible browser like Chrome or Edge.
        </div>
      </div>
    );
  }

  // Main app routes
  return (
    <div className="app-container">
      <Routes>
        <Route
          path="/"
          element={
            <NotesListPage
              notes={notes}
              onDeleteNote={handleDeleteNote}
              onPlayNote={handlePlayNote}
              onSemanticSearch={handleSemanticSearch}
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
          path="/note/:id"
          element={
            <NoteDetailPage
              getNoteWithAudio={getNoteWithAudio}
              currentNote={currentNote}
            />
          }
        />
        {/* Redirect /search to main page since search is now inline */}
        <Route
          path="/search"
          element={<Navigate to="/" replace />}
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
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
