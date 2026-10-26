import { useState } from 'react';
import { Bot, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@pixelforge/button';
import { useCartStore } from '@pixelforge/usecartstore';
import './index.css';

export const LandingHero = () => {
    const HERO_IMG = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&h=900&fit=crop&auto=format';
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
    const cart = useCartStore((state) => state.cart);
    const addToCart = useCartStore((state) => state.addToCart);
    const removeFromCart = useCartStore((state) => state.removeFromCart);
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: 'Hi! I can help with products, orders, delivery, returns, and PC support. What can I help you with?'
        }
    ]);
    const [history, setHistory] = useState([]);
    const [question, setQuestion] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');

    const sendMessage = async (event) => {
        event.preventDefault();
        const submittedQuestion = question.trim();

        if (!submittedQuestion || isSending) return;

        setQuestion('');
        setError('');
        setMessages((currentMessages) => [
            ...currentMessages,
            { role: 'user', content: submittedQuestion }
        ]);
        setIsSending(true);

        try {
            const response = await fetch(
                `${API_BASE_URL.replace(/\/$/, '')}/api/chat`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question: submittedQuestion,
                        history,
                        cart
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Support service returned ${response.status}`);
            }

            const data = await response.json();
            if (typeof data.answer !== 'string' || !data.answer.trim()) {
                throw new Error('Support service returned an empty answer');
            }
            if (!Array.isArray(data.cartActions)) {
                throw new Error('Support service returned invalid cart actions');
            }

            const validCartActions = data.cartActions.map((action) => {
                const validQuantity = Number.isInteger(action?.quantity)
                    ? action.quantity > 0 && action.quantity <= 99
                    : action?.quantity === 'all' && action.operation === 'remove';

                if (
                    !action ||
                    !['add', 'remove'].includes(action.operation) ||
                    !action.product?.id ||
                    !validQuantity
                ) {
                    throw new Error('Support service returned an invalid cart action');
                }
                return action;
            });

            for (const action of validCartActions) {
                if (action.operation === 'add') {
                    addToCart(action.product, action.quantity);
                } else {
                    removeFromCart(action.product.id, action.quantity);
                }
            }

            setMessages((currentMessages) => [
                ...currentMessages,
                { role: 'assistant', content: data.answer }
            ]);
            setHistory((currentHistory) => [
                ...currentHistory,
                { role: 'user', content: submittedQuestion },
                { role: 'assistant', content: data.answer }
            ]);
        } catch (requestError) {
            console.error('Could not send support chat message:', requestError);
            setError('Sorry, support chat is unavailable right now. Please try again later.');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <section className="landing-hero">
            <section 
                className="landing-hero__bg"
                style={{ backgroundImage : `url(${HERO_IMG})` }}
            ></section>
            <section className="landing-hero__content wrapper">
                <div className="landing-hero__copy">
                    <span className="landing-hero__badge">
                        New arrivals for autumn 2026
                    </span>

                    <h1 className="landing-hero__title">
                        Upgrade<br />
                        your game.
                    </h1>

                    <p className="landing-hero__description">
                        Premium gaming hardware curated by enthusiasts.
                        <br />
                        From custom-built PCs to the peripherals that pro
                        <br />
                        players trust.
                    </p>

                    <section className="landing-hero__actions">
                        <Button 
                            text="Shop products"
                            type="regular"
                            onClick={ () => console.log('Shop shop') }
                        />

                        <Button 
                            text="Explore gaming PCs"
                            type="outline"
                            onClick={ () => console.log('Explore') }
                        />
                    </section>
                </div>

                <section className="support-chat" aria-label="PixelForge AI support chat">
                    <header className="support-chat__header">
                        <span className="support-chat__avatar" aria-hidden="true">
                            <Bot size={20} />
                        </span>
                        <div>
                            <h2 className="support-chat__title">PixelForge Support</h2>
                            <p className="support-chat__status">
                                <span className="support-chat__status-dot" />
                                AI assistant
                            </p>
                        </div>
                    </header>

                    <div className="support-chat__messages" aria-live="polite">
                        {messages.map((message, index) => (
                            <div
                                className={`support-chat__message support-chat__message--${message.role}`}
                                key={`${message.role}-${index}`}
                            >
                                {message.role === 'assistant'
                                    ? <ReactMarkdown>{message.content}</ReactMarkdown>
                                    : message.content}
                            </div>
                        ))}
                        {isSending && (
                            <p className="support-chat__typing" role="status">
                                Finding an answer…
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="support-chat__error" role="alert">
                            {error}
                        </p>
                    )}

                    <form className="support-chat__form" onSubmit={sendMessage}>
                        <label className="support-chat__sr-only" htmlFor="support-chat-question">
                            Ask PixelForge Support
                        </label>
                        <input
                            id="support-chat-question"
                            className="support-chat__input"
                            type="text"
                            placeholder="Ask us anything..."
                            value={question}
                            onChange={(event) => setQuestion(event.target.value)}
                            disabled={isSending}
                            autoComplete="off"
                        />
                        <button
                            className="support-chat__send"
                            type="submit"
                            aria-label="Send message"
                            disabled={isSending || !question.trim()}
                        >
                            <Send size={18} />
                        </button>
                    </form>
                    <p className="support-chat__footnote">
                        AI-generated answers may not always be accurate.
                    </p>
                </section>
            </section>
        </section>
    )
}
