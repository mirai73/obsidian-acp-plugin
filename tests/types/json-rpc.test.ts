/**
 * Tests for JSON-RPC types and error codes
 */

import { JsonRpcErrorCode } from '../../src/types/json-rpc';

describe('JsonRpcErrorCode', () => {
	test('should have standard JSON-RPC 2.0 error codes', () => {
		expect(JsonRpcErrorCode.PARSE_ERROR).toBe(-32700);
		expect(JsonRpcErrorCode.INVALID_REQUEST).toBe(-32600);
		expect(JsonRpcErrorCode.METHOD_NOT_FOUND).toBe(-32601);
		expect(JsonRpcErrorCode.INVALID_PARAMS).toBe(-32602);
		expect(JsonRpcErrorCode.INTERNAL_ERROR).toBe(-32603);
	});

	test('should have ACP-specific error codes', () => {
		expect(JsonRpcErrorCode.FILE_NOT_FOUND).toBe(-32001);
		expect(JsonRpcErrorCode.PERMISSION_DENIED).toBe(-32002);
		expect(JsonRpcErrorCode.INVALID_PATH).toBe(-32003);
		expect(JsonRpcErrorCode.SESSION_NOT_FOUND).toBe(-32004);
		expect(JsonRpcErrorCode.CAPABILITY_NOT_SUPPORTED).toBe(-32005);
	});
});
