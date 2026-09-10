import { useUserStore } from './userStore';
import { userService } from '@/api/services/user.service';

// Mock userService
jest.mock('@/api/services/user.service', () => ({
  userService: {
    getAll: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateRole: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('userStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset store state
    const store = useUserStore.getState();
    // Zustand stores don't have setState on getState, we need to use set directly
    // For testing, we just need to clear mocks
  });

  describe('fetchUsers', () => {
    it('should fetch users successfully', async () => {
      const mockUsers = {
        success: true,
        message: 'OK',
        data: [
          {
            id: '1',
            username: 'john_doe',
            email: 'john@example.com',
            status: 'ACTIVE',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      };

      (userService.getAll as jest.Mock).mockResolvedValue(mockUsers);

      await useUserStore.getState().fetchUsers(1, 50);

      expect(useUserStore.getState().isLoading).toBe(false);
      expect(useUserStore.getState().users).toEqual(mockUsers);
      expect(useUserStore.getState().error).toBeNull();
    });

    it('should handle fetch error', async () => {
      (userService.getAll as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await useUserStore.getState().fetchUsers();

      expect(useUserStore.getState().isLoading).toBe(false);
      expect(useUserStore.getState().error).toBe('Network error');
    });
  });

  describe('fetchUserById', () => {
    it('should fetch user by id', async () => {
      const mockUser = {
        id: '1',
        username: 'john_doe',
        email: 'john@example.com',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (userService.getById as jest.Mock).mockResolvedValue(mockUser);

      await useUserStore.getState().fetchUserById('1');

      expect(useUserStore.getState().currentUser).toEqual(mockUser);
      expect(useUserStore.getState().isLoading).toBe(false);
    });
  });

  describe('createUser', () => {
    it('should create a user and refetch', async () => {
      (userService.create as jest.Mock).mockResolvedValue(undefined);
      (userService.getAll as jest.Mock).mockResolvedValue({
        success: true,
        message: 'OK',
        data: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
      });

      await useUserStore.getState().createUser({
        username: 'new_user',
        firstName: 'New',
        lastName: 'User',
        email: 'new@example.com',
        password: 'password123',
        roleId: 'role-1',
      });

      expect(userService.create).toHaveBeenCalled();
      expect(useUserStore.getState().isLoading).toBe(false);
    });

    it('should throw error on create failure', async () => {
      (userService.create as jest.Mock).mockRejectedValue(
        new Error('Create failed'),
      );

      await expect(
        useUserStore.getState().createUser({
          username: 'new_user',
          firstName: 'New',
          lastName: 'User',
          email: 'new@example.com',
          password: 'password123',
          roleId: 'role-1',
        }),
      ).rejects.toThrow('Create failed');
    });
  });

  describe('updateUser', () => {
    it('should update a user', async () => {
      const mockUser = {
        id: '1',
        username: 'updated_user',
        email: 'updated@example.com',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
      };

      (userService.update as jest.Mock).mockResolvedValue(mockUser);
      (userService.getAll as jest.Mock).mockResolvedValue({
        success: true,
        message: 'OK',
        data: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
      });

      await useUserStore.getState().updateUser({
        userId: '1',
        username: 'updated_user',
      });

      expect(userService.update).toHaveBeenCalled();
      expect(useUserStore.getState().currentUser).toEqual(mockUser);
    });
  });

  describe('refetchUsers', () => {
    it('should refetch users with current pagination', async () => {
      // First set up initial state
      (userService.getAll as jest.Mock).mockResolvedValue({
        success: true,
        message: 'OK',
        data: [],
        meta: { total: 10, page: 2, limit: 50, totalPages: 1 },
      });

      await useUserStore.getState().fetchUsers(2, 50);

      // Now refetch
      await useUserStore.getState().refetchUsers();

      expect(userService.getAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      (userService.updateRole as jest.Mock).mockResolvedValue(undefined);

      await useUserStore.getState().updateUserRole('user-1', 'role-2');

      expect(userService.updateRole).toHaveBeenCalledWith('user-1', 'role-2');
      expect(useUserStore.getState().isLoading).toBe(false);
    });
  });

  describe('deleteUser', () => {
    it('should delete a user and refetch', async () => {
      (userService.delete as jest.Mock).mockResolvedValue(undefined);
      (userService.getAll as jest.Mock).mockResolvedValue({
        success: true,
        message: 'OK',
        data: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
      });

      await useUserStore.getState().deleteUser('user-1');

      expect(userService.delete).toHaveBeenCalledWith('user-1');
      expect(useUserStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error', () => {
      useUserStore.getState().setError('Test error');
      expect(useUserStore.getState().error).toBe('Test error');
    });
  });
});
