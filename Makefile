.PHONY: help start dev install test clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make install  - Install dependencies"
	@echo "  make start    - Start the server in production mode"
	@echo "  make dev      - Start the server in development mode with nodemon"
	@echo "  make test     - Run tests"
	@echo "  make clean    - Clean node_modules and logs"

# Install dependencies
install:
	npm install

# Start server in production mode
start:
	npm start

# Start server in development mode with auto-reload
dev:
	npm run dev

# Run tests
test:
	npm test

# Clean up
clean:
	rm -rf node_modules
	rm -rf recordings/*
	find . -name "*.log" -delete 