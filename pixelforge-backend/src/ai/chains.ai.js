import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import {
    answerPrompt,
    directAnswerPrompt,
    productAnswerPrompt,
    productCategoryPrompt,
    retrievalDecisionPrompt,
    standaloneQuestionPrompt
} from "./prompts.ai.js";
import { llm } from "../config/ollama.config.js";
import { retrieveDocuments } from "./retriever.ai.js";
import { combineDocuments } from "../utils/combineDocuments.js";
import { productCatalogTool } from "./tools/productTools.js";
import { handleCartAction } from "./cartActions.ai.js";

const retrievalDecisionChain = RunnableSequence.from([
    retrievalDecisionPrompt,
    llm.withStructuredOutput(z.object({
        decision: z.enum(["DIRECT", "PRODUCT_LOOKUP", "RETRIEVE", "CART_ACTION"])
    }).strict(), {
        name: "chat_route",
        method: "jsonSchema"
    })
]);

const standaloneQuestionChain = RunnableSequence.from([
    standaloneQuestionPrompt,
    llm,
    new StringOutputParser()
]);

const directAnswerChain = RunnableSequence.from([
    directAnswerPrompt,
    llm,
    new StringOutputParser()
]);

const productCategoryChain = RunnableSequence.from([
    productCategoryPrompt,
    llm,
    new StringOutputParser()
]);

const productAnswerChain = RunnableSequence.from([
    productAnswerPrompt,
    llm,
    new StringOutputParser()
]);

const answerChain = RunnableSequence.from([
    answerPrompt,
    llm,
    new StringOutputParser()
]);

const hasExplicitCartAction = (question) =>
    /\b(?:can|could|would)\s+you\b.{0,80}\b(?:add|remove|put|take|empty|clear)\b|\b(?:add|remove|empty|clear)\b.{0,100}\b(?:to|from|in|into|out of)\s+(?:my|the)\s+(?:shopping\s+)?cart\b|^\s*(?:please\s+)?(?:add|remove|put|take|empty|clear)\b/i
        .test(question);

const formatDocumentSources = (documents) => {
    const sources = new Map();

    for (const document of documents) {
        const source = document.metadata?.source;
        const match = source?.match(/^doc-\d+_(.+)\.pdf$/i);

        if (!match) continue;

        const slug = match[1].toLowerCase();
        const title = slug
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

        sources.set(slug, { slug, title });
    }

    if (sources.size === 0) return "";

    const links = [...sources.values()]
        .map(({ slug, title }) => `- [${title}](/support/${slug})`)
        .join("\n");

    return `\n\nSources:\n${links}`;
};

async function answerProductQuestion(question, history = []) {
    const catalog = JSON.parse(await productCatalogTool.invoke({}));
    const formatPrice = (price) => (
        typeof price === "number"
            ? `${new Intl.NumberFormat("sv-SE", {
                maximumFractionDigits: 0
            }).format(price)} kr`
            : price
    );
    const categories = [...new Set(catalog.map((product) => product.category)
        .filter(Boolean))];
    const catalogIndex = JSON.stringify(catalog.map(({
        id,
        name,
        brand,
        category
    }) => ({ id, name, brand, category })));

    const categoryDecision = (
        await productCategoryChain.invoke({
            catalogIndex,
            question,
            history
        })
    ).trim();
    const explicitlyRequestsAll =
        /\b(?:all|entire|whole)\s+(?:(?:of\s+)?(?:the\s+)?)?(?:product\s+)?(?:catalog|range|selection|categories|products|items)\b|\b(?:across|from)\s+all\s+categories\b/i
            .test(question);

    const selectedCategories =
        explicitlyRequestsAll && /^all\b/i.test(categoryDecision)
        ? categories
        : categories.filter((category) =>
            categoryDecision.toLowerCase().includes(category.toLowerCase())
        );

    if (selectedCategories.length === 0) {
        const categoryList = categories.join(", ");
        return categoryDecision.toUpperCase() === "CLARIFY"
            ? `What type of product are you looking for? I can help with ${categoryList}.`
            : `I couldn't confidently match that to a product category. Which type did you mean: ${categoryList}?`;
    }

    const relevantProducts = catalog.filter((product) =>
        selectedCategories.includes(product.category)
    ).map((product) => ({
        ...product,
        price: formatPrice(product.price),
        originalPrice: formatPrice(product.originalPrice)
    }));

    return productAnswerChain.invoke({
        products: JSON.stringify(relevantProducts),
        question,
        history
    });
}

export const chain = RunnableLambda.from(
    async ({ question, history = [], cart = [] }) => {
        const decision = hasExplicitCartAction(question)
            ? "CART_ACTION"
            : (await retrievalDecisionChain.invoke({ question, history })).decision;

        if (decision === "DIRECT") {
            return {
                answer: await directAnswerChain.invoke({ question, history }),
                cartActions: []
            };
        }

        if (decision === "PRODUCT_LOOKUP") {
            return {
                answer: await answerProductQuestion(question, history),
                cartActions: []
            };
        }

        if (decision === "CART_ACTION") {
            return handleCartAction(question, history, cart);
        }

        const standaloneQuestion = await standaloneQuestionChain.invoke({
            question,
            history
        });
        const documents = await retrieveDocuments(standaloneQuestion);
        const context = combineDocuments(documents);
        const answer = await answerChain.invoke({ context, question, history });

        return {
            answer: `${answer}${formatDocumentSources(documents)}`,
            cartActions: []
        };
    }
);