import { Router } from "express";
import { chain } from "../ai/chains.ai.js";

const router = Router();

router.post('/', async (req, res) => {
    try {
        const { question, history = [], cart = [] } = req.body;
        const result = await chain.invoke({ question, history, cart });
        res.json(result);
    } catch (error) {
        console.error('Chat request failed:', error);
        res.status(500).json({
            error: 'The support assistant could not process your request.'
        });
    }
});

export default router;