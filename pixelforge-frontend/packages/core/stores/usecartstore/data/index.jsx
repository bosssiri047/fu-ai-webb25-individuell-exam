import { create } from 'zustand';

export const useCartStore = create((set) => ({
    cart: [],

    addToCart: (product, quantity = 1) => set((state) => {
        const existingProduct = state.cart.find(
            (item) => item.productId === product.id
        );

        if (existingProduct) {
            return {
                cart: state.cart.map((item) =>
                    item.productId === product.id
                        ? { ...item, qty: item.qty + quantity }
                        : item
                )
            };
        }

        return {
            cart: [
                ...state.cart,
                {
                    productId: product.id,
                    name: product.name,
                    price: product.price,
                    image: product.image,
                    qty: quantity
                }
            ]
        };
    }),

    removeFromCart: (productId, quantity = 1) => set((state) => ({
        cart: state.cart
            .map((item) =>
                item.productId === productId
                    ? {
                        ...item,
                        qty: quantity === 'all'
                            ? 0
                            : Math.max(0, item.qty - quantity)
                    }
                    : item
            )
            .filter((item) => item.qty > 0)
    })),

    clearCart: () => set({ cart: [] })
}));