import { OutputParserException } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import { cartActionPrompt } from "./prompts.ai.js";
import { cartLlm } from "../config/ollama.config.js";
import { productCatalogTool } from "./tools/productTools.js";

const cartActionChain = RunnableSequence.from([
    cartActionPrompt,
    cartLlm.withStructuredOutput(z.object({
        actions: z.array(z.object({
            operation: z.enum(["add", "remove"]),
            productQuery: z.string().min(1),
            quantity: z.union([
                z.number().int().min(1).max(99),
                z.literal("all")
            ])
        }).strict()),
        clearCart: z.boolean(),
        clarification: z.string()
    }).strict(), {
        name: "cart_action",
        method: "jsonSchema"
    })
]);

const isOutputParsingFailure = (error) =>
    error instanceof OutputParserException ||
    error?.name === "OutputParserException" ||
    error?.lc_error_code === "OUTPUT_PARSING_FAILURE";

function resolvePendingAddQuantity(question, history, catalog, cart) {
    const latestAssistantMessage = [...history]
        .reverse()
        .find((message) => message.role === "assistant")?.content ?? "";
    const awaitingQuantity =
        /\bhow many\b.*\badd\b|\bwhat quantity\b|\bchoose a number\b/i
            .test(latestAssistantMessage);
    if (!awaitingQuantity) return null;

    const quantityText = question.trim();
    const requestedAll =
        /^(?:all(?: of (?:them|it|those))?|everything|all available|all remaining|the max(?:imum)?|as many as possible)[.!?]*$/i
            .test(quantityText);
    const quantityMatch = quantityText.match(
        /^(?:(?:make it|add|I'd like|I want)\s+)?(\d{1,2})(?:\s+(?:more|units?|items?))?[.!?]*$/i
    );
    if (!requestedAll && !quantityMatch) return null;

    const stockPrompt = [...history]
        .reverse()
        .find((message) =>
            message.role === "assistant" &&
            /\b(?:stock|available)\b/i.test(message.content) &&
            /\b(?:how many|quantity|add)\b/i.test(message.content)
        );
    const product = stockPrompt
        ? catalog.find(({ name }) => stockPrompt.content.includes(name))
        : null;
    if (!product) return null;

    const cartItem = cart.find((item) => item.productId === product.id);
    const requestedQuantity = requestedAll
        ? Number.isInteger(product.stock)
            ? Math.max(0, product.stock - (cartItem?.qty ?? 0))
            : null
        : Number(quantityMatch[1]);

    if (requestedQuantity === null) {
        return {
            answer: `How many ${product.name} would you like to add?`,
            cartActions: []
        };
    }

    const available = Number.isInteger(product.stock)
        ? Math.max(0, product.stock - (cartItem?.qty ?? 0))
        : null;
    if (available !== null && requestedQuantity > available) {
        const availability = available === 0
            ? `You already have all ${product.stock} available ${product.name} in your cart.`
            : `You can add up to ${available} more ${product.name}${cartItem?.qty ? `; you already have ${cartItem.qty}` : ""}. How many would you like to add?`;
        return { answer: availability, cartActions: [] };
    }

    if (requestedQuantity === 0) {
        return {
            answer: `There are no more ${product.name} available to add.`,
            cartActions: []
        };
    }

    return {
        answer: `Added ${requestedQuantity} × ${product.name} to your cart.`,
        cartActions: [{
            operation: "add",
            product: {
                id: product.id,
                name: product.name,
                price: product.price,
                image: product.image
            },
            quantity: requestedQuantity
        }]
    };
}

function getExplicitQuantity(question, product) {
    const productTokens = product.name
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [];
    const numberWords = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        a: 1,
        an: 1
    };
    const quantityPattern =
        /(?:^|\s)(?:and\s+)?(?:(?:please\s+)?(?:add|remove|put|place|order|buy)\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)\s+(?:[a-z]+\s+){0,3}$/i;
    const normalizedQuestion = question.toLowerCase();
    const positions = new Set();

    for (let length = productTokens.length; length >= 2; length -= 1) {
        for (let start = 0; start <= productTokens.length - length; start += 1) {
            const phrase = productTokens
                .slice(start, start + length)
                .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("[\\W_]+");
            for (const match of normalizedQuestion.matchAll(new RegExp(phrase, "gi"))) {
                positions.add(match.index);
            }
        }
        if (positions.size > 0) break;
    }

    if (positions.size === 0) {
        for (const token of productTokens) {
            const position = normalizedQuestion.indexOf(token);
            if (position >= 0) positions.add(position);
        }
    }

    for (const position of [...positions].sort((first, second) => first - second)) {
        const quantityMatch = question
            .slice(0, position)
            .match(quantityPattern);
        if (!quantityMatch) continue;

        const rawQuantity = quantityMatch[1].toLowerCase();
        const quantity = numberWords[rawQuantity] ?? Number(rawQuantity);
        if (Number.isInteger(quantity) && quantity > 0 && quantity <= 99) {
            return quantity;
        }
    }

    return null;
}

const ignoredProductTerms = new Set([
    "a", "an", "and", "another", "card", "cards", "geforce", "graphics",
    "gpu", "i", "item", "me", "my", "one", "option", "product", "please",
    "the", "that", "this", "to", "two", "want", "add", "remove", "cart",
    "from", "into", "with", "for", "buy", "put", "order"
]);

function matchCatalogProducts(productQuery, question, catalog) {
    const queryTerms = productQuery.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const requestedTerms = (question.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        .filter((term) => !ignoredProductTerms.has(term));
    const mentionedTerms = queryTerms.filter(
        (term) => !ignoredProductTerms.has(term) && requestedTerms.includes(term)
    );
    const identifyingTerms = mentionedTerms.length > 0
        ? mentionedTerms
        : queryTerms.filter((term) => !ignoredProductTerms.has(term));

    return identifyingTerms.length === 0
        ? []
        : catalog.filter((product) => {
            const catalogTerms = new Set(
                `${product.name} ${product.brand ?? ""} ${product.category ?? ""}`
                    .toLowerCase()
                    .match(/[a-z0-9]+/g) ?? []
            );
            return identifyingTerms.every((term) => catalogTerms.has(term));
        });
}

function findExplicitProducts(question, catalog) {
    const segments = question.split(/[,;]|\band\b/i);
    const matches = new Map();

    for (const segment of segments) {
        const segmentTerms = new Set(
            (segment.toLowerCase().match(/[a-z0-9]+/g) ?? [])
                .filter((term) => !ignoredProductTerms.has(term))
        );
        const ranked = catalog.map((product) => {
            const productTerms = [...new Set(
                `${product.name} ${product.brand ?? ""}`
                    .toLowerCase()
                    .match(/[a-z0-9]+/g) ?? []
            )].filter((term) => !ignoredProductTerms.has(term));
            const matchedTerms = productTerms.filter((term) => segmentTerms.has(term));
            return {
                product,
                score: productTerms.length > 0
                    ? matchedTerms.length / productTerms.length
                    : 0,
                matchedCount: matchedTerms.length
            };
        }).filter(({ score, matchedCount }) => score >= 0.6 && matchedCount >= 2)
            .sort((first, second) => second.score - first.score);

        if (
            ranked.length > 0 &&
            (ranked.length === 1 || ranked[0].score > ranked[1].score)
        ) {
            matches.set(ranked[0].product.id, ranked[0].product);
        }
    }

    return [...matches.values()];
}

export async function handleCartAction(question, history, cart = []) {
    const catalog = JSON.parse(await productCatalogTool.invoke({}));
    const pendingQuantity = resolvePendingAddQuantity(
        question,
        history,
        catalog,
        cart
    );
    if (pendingQuantity) return pendingQuantity;

    const catalogIndex = catalog
        .map(({ name, brand }) => `${brand ? `${brand} ` : ""}${name}`)
        .join("\n");
    const modelInput = {
        catalogIndex,
        cart: JSON.stringify(cart),
        question,
        history: history.slice(-12).map((message) => ({
            ...message,
            content: String(message.content ?? "").slice(-1000)
        }))
    };
    let result;
    try {
        result = await cartActionChain.invoke(modelInput);
    } catch (error) {
        if (!isOutputParsingFailure(error)) throw error;

        console.error(
            "Cart action output was malformed; retrying with compact context."
        );
        try {
            result = await cartActionChain.invoke({
                ...modelInput,
                history: history.slice(-6).map((message) => ({
                    ...message,
                    content: String(message.content ?? "").slice(-600)
                }))
            });
        } catch (retryError) {
            if (!isOutputParsingFailure(retryError)) throw retryError;

            console.error(
                "Cart action output remained malformed after retry."
            );
            return {
                answer: "I couldn't safely process that cart change just now. Please try the request again, or send one product and quantity at a time.",
                cartActions: []
            };
        }
    }

    if (result.clearCart) {
        if (cart.length === 0) {
            return { answer: "Your cart is already empty.", cartActions: [] };
        }

        return {
            answer: "I emptied your cart.",
            cartActions: cart.map((item) => ({
                operation: "remove",
                product: {
                    id: item.productId,
                    name: item.name,
                    price: item.price,
                    image: item.image
                },
                quantity: "all"
            }))
        };
    }

    if (result.actions.length === 0) {
        return {
            answer: result.clarification || "Which product and cart change did you mean?",
            cartActions: []
        };
    }

    if (
        new Set(result.actions.map(({ operation }) => operation)).size === 1 &&
        !/\b(?:don't|do not|never|not)\s+(?:want to\s+)?add\b/i.test(question)
    ) {
        const representedProducts = new Set(result.actions.flatMap((action) =>
            matchCatalogProducts(action.productQuery, question, catalog)
                .map(({ id }) => id)
        ));
        const operation = result.actions[0].operation;
        for (const product of findExplicitProducts(question, catalog)) {
            if (representedProducts.has(product.id)) continue;

            result.actions.push({
                operation,
                productQuery: product.name,
                quantity: getExplicitQuantity(question, product) ?? 1
            });
        }
    }

    const cartActions = [];
    for (const action of result.actions) {
        if (!action || !["add", "remove"].includes(action.operation)) {
            console.error("Cart action model returned an invalid operation");
            return {
                answer: "I couldn't identify whether you want to add or remove that product. Could you clarify?",
                cartActions: []
            };
        }

        const matches = matchCatalogProducts(
            action.productQuery ?? "",
            question,
            catalog
        );

        if (matches.length > 1) {
            const quantity = Number.isInteger(action.quantity) && action.quantity > 0
                ? action.quantity
                : 1;
            return {
                answer: `I found several matching products. Which one should I ${action.operation} (${quantity} ${quantity === 1 ? "item" : "items"})?\n${matches
                    .slice(0, 8)
                    .map((product, index) => `${index + 1}. ${product.name}`)
                    .join("\n")}\nReply with a number or the product name.`,
                cartActions: []
            };
        }

        if (matches.length === 0) {
            return {
                answer: result.clarification || `I couldn't find “${action.productQuery ?? "that product"}” in the catalog. Could you give me the product name or model?`,
                cartActions: []
            };
        }

        const product = matches[0];
        const cartItem = cart.find((item) => item.productId === product.id);
        const explicitQuantity = getExplicitQuantity(question, product);
        const actionQuantity = explicitQuantity ?? action.quantity;
        const removeAll = action.operation === "remove" && actionQuantity === "all";
        const availableToAdd = Number.isInteger(product.stock)
            ? Math.max(0, product.stock - (cartItem?.qty ?? 0))
            : null;
        const quantity = actionQuantity === "all" && action.operation === "add"
            ? availableToAdd
            : actionQuantity;
        if (action.operation === "add" && quantity === 0) {
            return {
                answer: `There are no more ${product.name} available to add.`,
                cartActions: []
            };
        }
        if (
            (quantity !== "all" && (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)) ||
            (action.operation === "add" && quantity === null)
        ) {
            return {
                answer: "What quantity would you like? Please choose a number from 1 to 99.",
                cartActions: []
            };
        }

        if (action.operation === "remove" && !cartItem) {
            return {
                answer: `${product.name} isn't in your cart, so I haven't removed anything.`,
                cartActions: []
            };
        }

        const resolvedQuantity = removeAll
            ? "all"
            : action.operation === "remove"
                ? Math.min(quantity, cartItem.qty)
                : quantity;

        if (
            action.operation === "add" &&
            availableToAdd !== null &&
            quantity > availableToAdd
        ) {
            const availability = availableToAdd === 0
                ? `You already have all ${product.stock} ${product.name} in your cart.`
                : `You can add up to ${availableToAdd} more ${product.name}${cartItem?.qty ? `; you already have ${cartItem.qty}` : ""}. How many would you like to add?`;
            return {
                answer: availability,
                cartActions: []
            };
        }

        cartActions.push({
            operation: action.operation,
            product: {
                id: product.id,
                name: product.name,
                price: product.price,
                image: product.image
            },
            quantity: resolvedQuantity
        });
    }

    const answer = cartActions.map(({ operation, product, quantity }) => {
        if (operation === "add") {
            return `Added ${quantity} × ${product.name} to your cart.`;
        }

        return quantity === "all"
            ? `Removed ${product.name} from your cart.`
            : `Removed ${quantity} × ${product.name} from your cart.`;
    }).join("\n");

    return { answer, cartActions };
}
