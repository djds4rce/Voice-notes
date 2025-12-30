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

  // Initialize database
  useEffect(() => {
    async function initDb() {
      try {
        const dbInstance = await DatabaseService.getInstance();
        setDb(dbInstance);
        // Load initial notes
        const allNotes = await dbInstance.getAllNotes();
        setNotes(allNotes);
        console.log('[App] Database initialized, loaded', allNotes.length, 'notes');
      } catch (error) {
        console.error('[App] Failed to initialize database:', error);
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
    worker.current?.postMessage({ type: 'load' });
    setStatus('loading');
  }, []);

  // Save a new note
  const handleSaveNote = useCallback(async ({ transcript, audioBlob, durationSeconds, wordTimestamps }) => {
    if (!db) return;

    try {
      const note = await db.createNote({
        transcript,
        audioBlob,
        durationSeconds,
        wordTimestamps,
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
      const embeddingService = await EmbeddingService.getInstance();
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
      navigate(`/note/${note.id}`);
    }
  }, [getNoteWithAudio, navigate]);

  // Model not loaded - show load screen
  if (status === null) {
    return (
      <div className="app-container center">
        <div className="load-screen">
          <div className="logo-container">
            <img src="/logo192.png" alt="Voice Notes" className="app-logo" />
          </div>
          <h1 className="app-title">Voice Notes</h1>
          <p className="app-subtitle">AI-powered voice memos with semantic search</p>

          <p className="load-description">
            Load the Whisper model to start recording. The model (~200 MB)
            will be cached and reused when you revisit.
          </p>

          {IS_WEBGPU_AVAILABLE ? (
            <button className="load-button" onClick={loadModel}>
              Load Model
            </button>
          ) : (
            <div className="error-message">
              WebGPU is not supported by this browser
            </div>
          )}
        </div>
      </div>
    );
  }

  // Model loading
  if (status === 'loading') {
    return (
      <div className="app-container center">
        <div className="loading-screen">
          <h2 className="loading-title">{loadingMessage}</h2>
          <div className="progress-container">
            {progressItems.map(({ file, progress, total }, i) => (
              <Progress key={i} text={file} percentage={progress} total={total} />
            ))}
          </div>
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
            />
          }
        />
        <Route
          path="/record"
          element={
            <RecordingScreen
              worker={worker.current}
              onSaveNote={handleSaveNote}
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
