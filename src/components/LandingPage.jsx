/**
 * Landing Page for AI Voice Note
 * 
 * Privacy-focused landing page showcasing the app's key features
 * and browser-based AI capabilities.
 */

import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

export function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="landing-page">
            {/* Hero Section */}
            <header className="landing-hero">
                <div className="hero-content">
                    <div className="hero-badge">
                        <span className="badge-text">100% Local & Private</span>
                    </div>

                    <h1 className="hero-title">
                        AI Voice Note
                    </h1>

                    <p className="hero-tagline">
                        Capture your thoughts instantly with AI-powered transcription —
                        <strong> entirely in your browser</strong>.
                    </p>

                    <button
                        className="hero-cta"
                        onClick={() => navigate('/notes')}
                    >
                        Get Started
                        <span className="cta-arrow">→</span>
                    </button>
                </div>
            </header>

            {/* Privacy Section */}
            <section className="landing-section privacy-section">
                <h2 className="section-title">Your Voice, Your Data</h2>
                <p className="section-description">
                    Every word you speak stays on <strong>your device</strong>. No cloud uploads,
                    no third-party servers, no data collection. Your voice notes are processed
                    entirely in your browser using cutting-edge WebGPU technology.
                </p>

                <div className="privacy-badges">
                    <div className="privacy-badge">
                        <span>No Cloud</span>
                    </div>
                    <div className="privacy-badge">
                        <span>End-to-End Private</span>
                    </div>
                    <div className="privacy-badge">
                        <span>Local Storage</span>
                    </div>
                </div>
            </section>

            {/* AI Exploration Section */}
            <section className="landing-section ai-section">
                <h2 className="section-title">AI in the Browser</h2>
                <p className="section-description">
                    This is an <strong>exploration of running AI models directly in your browser</strong>.
                    Using WebGPU and Whisper AI, we're pushing the boundaries of what's possible
                    without sending a single byte to external servers.
                </p>

                <div className="tech-stack">
                    <div className="tech-item">
                        <span className="tech-name">WebGPU</span>
                    </div>
                    <div className="tech-item">
                        <span className="tech-name">Whisper AI</span>
                    </div>
                    <div className="tech-item">
                        <span className="tech-name">Semantic Search</span>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="landing-section features-section">
                <h2 className="section-title">Features</h2>

                <div className="features-grid">
                    <div className="feature-card">
                        <h3 className="feature-title">Live Transcription</h3>
                        <p className="feature-description">
                            Watch your words appear in real-time as you speak
                        </p>
                    </div>

                    <div className="feature-card">
                        <h3 className="feature-title">Smart Search</h3>
                        <p className="feature-description">
                            Find notes by meaning, not just keywords
                        </p>
                    </div>

                    <div className="feature-card">
                        <h3 className="feature-title">Auto Tagging</h3>
                        <p className="feature-description">
                            AI-generated tags for easy organization
                        </p>
                    </div>

                    <div className="feature-card">
                        <h3 className="feature-title">Dark Mode</h3>
                        <p className="feature-description">
                            Easy on the eyes, day or night
                        </p>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="landing-section cta-section">
                <h2 className="cta-title">Ready to start?</h2>
                <p className="cta-description">
                    No signup required. Just click and start recording.
                </p>
                <button
                    className="hero-cta"
                    onClick={() => navigate('/notes')}
                >
                    Open App
                    <span className="cta-arrow">→</span>
                </button>
            </section>

            {/* Footer */}
            <footer className="landing-footer">
                <p className="footer-text">
                    Made for privacy enthusiasts
                </p>
                <p className="footer-domain">aivoicenote.app</p>
            </footer>
        </div>
    );
}
